const config = require('./config')
const path = require('path')
const fs = require('fs')
const express = require('express')
const session = require('express-session')
const passport = require('passport')
const GitHubStrategy = require('passport-github2').Strategy
const SqliteSessionStore = require('./sessionStore')
const { SearchError, buildSearchQuery, parsePage, searchRepos } = require('./github')
const { rateLimit } = require('express-rate-limit')
const pino = require('pino')
const pinoHttp = require('pino-http')
const { db, upsertVisit, getRecentRepos, addRecentSearch, getRecentSearches, clearRecentSearches, setNeedsPrompt, getNeedsPrompt, clearNeedsPrompt } = require('./db')

const { isProd } = config

const logger = pino({
  level: 'info',
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } }
})

const app = express()

// Railway (and most hosts) terminate HTTPS at a proxy in front of the app.
// Trusting it lets secure cookies and per-client rate limiting work.
if (isProd) {
  app.set('trust proxy', 1)
}

app.use(pinoHttp({ logger }))

app.use(express.json())

// Session configuration
const sessionMiddleware = session({
  store: new SqliteSessionStore({ db, secret: config.sessionSecret }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  name: 'connect.sid',
  cookie: {
    secure: isProd,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  }
})

app.use(sessionMiddleware)

// Passport OAuth configuration
app.use(passport.initialize())
app.use(passport.session())

passport.use(new GitHubStrategy({
    clientID: config.githubClientId,
    clientSecret: config.githubClientSecret,
    callbackURL: config.appUrl + '/auth/github/callback',
    // Guards the OAuth round trip against login CSRF
    state: true
  },
  function(accessToken, refreshToken, profile, done) {
    const user = {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      avatar: profile.photos[0]?.value,
      accessToken: accessToken
    }
    return done(null, user)
  }
))

passport.serializeUser((user, done) => {
  done(null, user)
})

passport.deserializeUser((user, done) => {
  done(null, user)
})

// Initiates GitHub OAuth flow
// 'repo' is needed for private repositories to appear in search results.
// GitHub has no read-only variant of this scope for OAuth apps.
app.get('/auth/github', passport.authenticate('github', { scope: ['repo'] }))

// GitHub OAuth callback - user returns here after authorizing
app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/' }),
  (req, res) => {
    setNeedsPrompt(req.user.id)
    logger.info({ userId: req.user.id }, 'User logged in')
    res.redirect('/')
  }
)

// Check if user needs to see the "remember me" prompt
app.get('/auth/check-prompt', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ showPrompt: getNeedsPrompt(req.user.id) })
  } else {
    res.json({ showPrompt: false })
  }
})

// Save user's "remember me" preference
app.post('/auth/remember', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { remember } = req.body

  // Default to "remember me" (30 days) if user dismisses or closes modal
  const sessionDuration = remember !== false ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000
  req.session.cookie.maxAge = sessionDuration
  clearNeedsPrompt(req.user.id)

  logger.info({ userId: req.user.id, duration: remember !== false ? '30 days' : '2 hours' }, 'Session duration set')

  // Persist the session with new expiration
  req.session.save((err) => {
    if (err) {
      logger.error({ err }, 'Session save error')
      return res.status(500).json({ error: 'Failed to save preference' })
    }
    res.json({ success: true })
  })
})

// Log out. Visit history is kept so it is there on the next login.
// POST so that other sites can't log users out with a simple link.
app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      logger.error({ err }, 'Logout failed')
      return res.status(500).json({ error: 'Logout failed' })
    }
    req.session.destroy((err) => {
      if (err) {
        logger.error({ err }, 'Session destruction failed')
        return res.status(500).json({ error: 'Logout failed' })
      }
      res.clearCookie('connect.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: isProd })
      res.json({ message: 'Logged out successfully' })
    })
  })
})

// Get current authenticated user
app.get('/auth/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar
      }
    })
  } else {
    res.status(401).json({ user: null })
  }
})

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' }
})

// Repository search via the GitHub API
app.get('/api/search', searchLimiter, async (req, res) => {
  try {
    const { q, languages = '', dateFilter = 'all' } = req.query
    const languageList = String(languages).split(',').filter(Boolean)
    const query = buildSearchQuery(q, languageList, dateFilter)
    const page = parsePage(req.query.page)

    logger.info({ query, page }, 'GitHub search')

    const loggedIn = req.isAuthenticated()
    const results = await searchRepos({
      query,
      page,
      userToken: loggedIn ? req.user.accessToken : undefined,
      serverToken: config.githubToken
    })

    // Remember new searches (not page changes) for logged-in users
    if (loggedIn && page === 1) {
      addRecentSearch(req.user.id, String(q).trim(), languageList, dateFilter)
    }
    res.json(results)
  } catch (error) {
    if (error instanceof SearchError) {
      return res.status(error.status).json({ error: error.message })
    }
    logger.error({ err: error }, 'Search failed')
    res.status(500).json({ error: 'Search failed. Please try again.' })
  }
})

// Require login for the routes below that use it
function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  next()
}

// Track repository visit
app.post('/api/track-visit', requireAuth, (req, res) => {
  const { repoUrl, repoName, repoData } = req.body
  upsertVisit(req.user.id, repoUrl, repoName, repoData)
  res.json({ message: 'Visit tracked' })
})

// Get user's most recently visited repos
app.get('/api/recent-repos', requireAuth, (req, res) => {
  res.json({ repos: getRecentRepos(req.user.id, 10) })
})

// Get and clear the user's recent searches
app.get('/api/recent-searches', requireAuth, (req, res) => {
  res.json({ searches: getRecentSearches(req.user.id) })
})

app.delete('/api/recent-searches', requireAuth, (req, res) => {
  clearRecentSearches(req.user.id)
  res.json({ message: 'Recent searches cleared' })
})

// Serve the built frontend (git-seek/dist) so the whole app runs on one origin.
// In development Vite serves the frontend and proxies /api and /auth here instead.
const distDir = path.join(__dirname, '..', 'git-seek', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api\/|auth\/).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

module.exports = { app, logger }
