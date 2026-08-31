const express = require('express')
const cors = require('cors')
const session = require('express-session')
const passport = require('passport')
const GitHubStrategy = require('passport-github2').Strategy
const SqliteStore = require('better-sqlite3-session-store')(session)
const { db, upsertVisit, getMostVisited, deleteUserVisits, setNeedsPrompt, getNeedsPrompt, clearNeedsPrompt } = require('./db')
require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 5000

// Middleware setup
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}))
app.use(express.json())

// Session configuration
const sessionMiddleware = session({
  store: new SqliteStore({ client: db }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  name: 'connect.sid',
  cookie: {
    secure: process.env.NODE_ENV === 'production',
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
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.BACKEND_URL + '/auth/github/callback'
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
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }))

// GitHub OAuth callback - user returns here after authorizing
app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: process.env.FRONTEND_URL }),
  (req, res) => {
    setNeedsPrompt(req.user.id)
    console.log(`User ${req.user.id} logged in successfully`)
    res.redirect(process.env.FRONTEND_URL)
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

  console.log(`User ${req.user.id} session set to: ${remember !== false ? '30 days' : '2 hours'}`)

  // Persist the session with new expiration
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err)
      return res.status(500).json({ error: 'Failed to save preference' })
    }
    res.json({ success: true })
  })
})

// Logout and cleanup
app.get('/auth/logout', (req, res) => {
  const userId = req.user?.id

  if (userId) {
    deleteUserVisits(userId)
    clearNeedsPrompt(userId)
  }

  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' })
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Session destruction failed' })
      }
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax'
      })
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

// Repository Search with GitHub API
app.get('/api/search', async (req, res) => {
  try {
    const { q, languages, dateFilter, page = 1 } = req.query

    if (!q) {
      return res.status(400).json({ error: 'Query parameter required' })
    }

    const axios = require('axios')
    const headers = {}

    // Use authenticated user's token for higher rate limits
    if (req.isAuthenticated() && req.user.accessToken) {
      headers.Authorization = `token ${req.user.accessToken}`
    }

    // Build GitHub search query with filters
    let searchQuery = q

    // Add language filters (e.g., "language:JavaScript language:Python")
    if (languages && languages.length > 0) {
      const langArray = languages.split(',').filter(l => l)
      langArray.forEach(lang => {
        searchQuery += ` language:${lang}`
      })
    }

    // Add date filter (e.g., "pushed:>=2024-10-01")
    if (dateFilter && dateFilter !== 'all') {
      const now = new Date()
      let date

      if (dateFilter === 'week') {
        date = new Date(now.setDate(now.getDate() - 7))
      } else if (dateFilter === 'month') {
        date = new Date(now.setMonth(now.getMonth() - 1))
      } else if (dateFilter === 'year') {
        date = new Date(now.setFullYear(now.getFullYear() - 1))
      }

      if (date) {
        const dateString = date.toISOString().split('T')[0]
        searchQuery += ` pushed:>=${dateString}`
      }
    }

    console.log(`Search query: "${searchQuery}", page: ${page}`)

    // Fetch from GitHub API with pagination
    const response = await axios.get(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc&page=${page}&per_page=30`,
      { headers }
    )

    // Return both items and total count so frontend knows how many pages exist
    res.json({
      items: response.data.items,
      total_count: response.data.total_count,
      current_page: parseInt(page)
    })
  } catch (error) {
    console.error('Search error:', error.message)
    res.status(500).json({ error: 'Search failed' })
  }
})

// Track repository visit
app.post('/api/track-visit', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { repoUrl, repoName, repoData } = req.body
  upsertVisit(req.user.id, repoUrl, repoName, repoData)
  res.json({ message: 'Visit tracked' })
})

// Get user's most recently visited repos
app.get('/api/most-visited', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  res.json({ repos: getMostVisited(req.user.id, 10) })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Frontend should be at: ${process.env.FRONTEND_URL}`)
})
