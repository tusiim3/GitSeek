const config = require('./config')
const path = require('path')
const fs = require('fs')
const express = require('express')
const session = require('express-session')
const passport = require('passport')
const GitHubStrategy = require('passport-github2').Strategy
const EncryptedSessionStore = require('./sessionStore')
const { SearchError, buildSearchQuery, parsePage, searchRepos } = require('./github')
const { rateLimit } = require('express-rate-limit')
const pino = require('pino')
const pinoHttp = require('pino-http')
const db = require('./db')

const { isProd } = config

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Session cookies and tokens must never end up in logs
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    censor: '[redacted]'
  },
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } }
})

const app = express()

// Render (like most hosts) terminates HTTPS at a proxy in front of the app.
// Trusting one hop, as Render's docs recommend for Express, lets secure
// cookies and per-client rate limiting work.
if (isProd) {
  app.set('trust proxy', 1)
}

// Health check for uptime monitors (e.g. UptimeRobot keeping Render awake).
// Registered before logging and sessions so it never touches the database
// and doesn't fill the logs with a line every few minutes.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use(pinoHttp({ logger }))

app.use(express.json())

// Session configuration
const sessionStore = new EncryptedSessionStore({ db, secret: config.sessionSecret })
const sessionMiddleware = session({
  store: sessionStore,
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
  async (req, res) => {
    await db.setNeedsPrompt(req.user.id)
    logger.info({ userId: req.user.id }, 'User logged in')
    res.redirect('/')
  }
)

// Check if user needs to see the "remember me" prompt
app.get('/auth/check-prompt', async (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ showPrompt: await db.getNeedsPrompt(req.user.id) })
  } else {
    res.json({ showPrompt: false })
  }
})

// Save user's "remember me" preference
app.post('/auth/remember', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { remember } = req.body

  // Default to "remember me" (30 days) if user dismisses or closes modal
  const sessionDuration = remember !== false ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000
  req.session.cookie.maxAge = sessionDuration
  await db.clearNeedsPrompt(req.user.id)

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
    // (a failure here shouldn't fail the search itself)
    if (loggedIn && page === 1) {
      await db.addRecentSearch(req.user.id, String(q).trim(), languageList, dateFilter)
        .catch((err) => logger.error({ err }, 'Saving recent search failed'))
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
app.post('/api/track-visit', requireAuth, async (req, res) => {
  const { repoUrl, repoName, repoData } = req.body ?? {}
  const validUrl = typeof repoUrl === 'string' && repoUrl.startsWith('https://github.com/')
  if (!validUrl || typeof repoName !== 'string' || !repoName) {
    return res.status(400).json({ error: 'repoUrl and repoName are required' })
  }
  await db.upsertVisit(req.user.id, repoUrl, repoName, repoData)
  res.json({ message: 'Visit tracked' })
})

// Get user's most recently visited repos
app.get('/api/recent-repos', requireAuth, async (req, res) => {
  res.json({ repos: await db.getRecentRepos(req.user.id, 10) })
})

// Get and clear the user's recent searches
app.get('/api/recent-searches', requireAuth, async (req, res) => {
  res.json({ searches: await db.getRecentSearches(req.user.id) })
})

app.delete('/api/recent-searches', requireAuth, async (req, res) => {
  await db.clearRecentSearches(req.user.id)
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

// Errors thrown in routes (e.g. the database is unreachable) end up here.
// Express 5 forwards rejected promises from async handlers automatically.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error')
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

module.exports = { app, db, logger, sessionStore }
