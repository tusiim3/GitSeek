const express = require('express')
const cors = require('cors')
const session = require('express-session')
const passport = require('passport')
const GitHubStrategy = require('passport-github2').Strategy
require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 5000

// In-memory storage (no database)
const userSessions = new Map()
const recentSearches = new Map()
const visitedRepos = new Map()
const needsRememberPrompt = new Set() // Track users who need to see prompt

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}))
app.use(express.json())

// Dynamic session configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on every request
  name: 'connect.sid',
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 2 * 60 * 60 * 1000, // Default 2 hours
    sameSite: 'lax',
    path: '/'
  }
})

app.use(sessionMiddleware)

// Passport Configuration
app.use(passport.initialize())
app.use(passport.session())

passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: "http://localhost:5000/auth/github/callback"
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

// Auth Routes
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }))

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: process.env.FRONTEND_URL }),
  (req, res) => {
    // Initialize user data structures
    if (!recentSearches.has(req.user.id)) {
      recentSearches.set(req.user.id, [])
    }
    if (!visitedRepos.has(req.user.id)) {
      visitedRepos.set(req.user.id, new Map())
    }
    
    // Mark this user as needing the remember prompt
    needsRememberPrompt.add(req.user.id)
    
    console.log(`User ${req.user.id} logged in, needs prompt: true`)
    
    res.redirect(process.env.FRONTEND_URL)
  }
)

// Check if prompt should be shown
app.get('/auth/check-prompt', (req, res) => {
  if (req.isAuthenticated()) {
    const showPrompt = needsRememberPrompt.has(req.user.id)
    console.log(`Check prompt for ${req.user.id}: ${showPrompt}`)
    res.json({ showPrompt })
  } else {
    res.json({ showPrompt: false })
  }
})

// Set "remember me" preference
app.post('/auth/remember', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  
  const { remember } = req.body
  
  console.log(`User ${req.user.id} chose remember: ${remember}`)
  
  if (remember) {
    // Extend session to 30 days
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000
  } else {
    // Short session - 2 hours
    req.session.cookie.maxAge = 2 * 60 * 60 * 1000
  }
  
  // Remove from prompt set
  needsRememberPrompt.delete(req.user.id)
  
  // Save the session with new settings
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err)
      return res.status(500).json({ error: 'Failed to save preference' })
    }
    res.json({ success: true })
  })
})

app.get('/auth/logout', (req, res) => {
  const userId = req.user?.id
  
  console.log(`Logging out user: ${userId}`)
  
  // Clear user data from memory
  if (userId) {
    recentSearches.delete(userId)
    visitedRepos.delete(userId)
    needsRememberPrompt.delete(userId)
  }
  
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err)
      return res.status(500).json({ error: 'Logout failed' })
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err)
        return res.status(500).json({ error: 'Session destruction failed' })
      }
      // Clear the cookie properly
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax'
      })
      res.json({ message: 'Logged out successfully' })
    })
  })
})

app.get('/auth/user', (req, res) => {
  if (req.isAuthenticated()) {
    console.log(`Auth check for user: ${req.user.id}`)
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar
      }
    })
  } else {
    console.log('Auth check: No user')
    res.status(401).json({ user: null })
  }
})

// Search Route with GitHub API
app.get('/api/search', async (req, res) => {
  try {
    const { q, languages, dateFilter } = req.query
    if (!q) {
      return res.status(400).json({ error: 'Query parameter required' })
    }

    const axios = require('axios')
    const headers = {}
    
    if (req.isAuthenticated() && req.user.accessToken) {
      headers.Authorization = `token ${req.user.accessToken}`
    }

    // Build GitHub search query
    let searchQuery = q

    // Add language filters
    if (languages && languages.length > 0) {
      const langArray = languages.split(',').filter(l => l)
      langArray.forEach(lang => {
        searchQuery += ` language:${lang}`
      })
    }

    // Add date filter
    if (dateFilter && dateFilter !== 'all') {
      const dateMap = {
        'week': '7 days',
        'month': '1 month',
        'year': '1 year'
      }
      const now = new Date()
      let date
      
      if (dateFilter === 'week') {
        date = new Date(now.setDate(now.getDate() - 7))
      } else if (dateFilter === 'month') {
        date = new Date(now.setMonth(now.getMonth() - 1))
      } else if (dateFilter === 'year') {
        date = new Date(now.setFullYear(now.getFullYear() - 1))
      }
      
      const dateString = date.toISOString().split('T')[0]
      searchQuery += ` pushed:>=${dateString}`
    }

    console.log('Search query:', searchQuery)

    const response = await axios.get(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc`,
      { headers }
    )

    if (req.isAuthenticated()) {
      const searches = recentSearches.get(req.user.id) || []
      searches.unshift({ query: q, timestamp: Date.now() })
      recentSearches.set(req.user.id, searches.slice(0, 10))
    }

    res.json(response.data)
  } catch (error) {
    console.error('Search error:', error.message)
    res.status(500).json({ error: 'Search failed' })
  }
})

// Recent Searches Route
app.get('/api/recent-searches', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  
  const searches = recentSearches.get(req.user.id) || []
  res.json({ searches })
})

// Track Visited Repo
app.post('/api/track-visit', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { repoUrl, repoName, repoData } = req.body
  const repos = visitedRepos.get(req.user.id) || new Map()
  
  // Store repo with full details
  const existing = repos.get(repoUrl) || { count: 0 }
  repos.set(repoUrl, {
    url: repoUrl,
    name: repoName,
    count: existing.count + 1,
    lastVisited: Date.now(),
    description: repoData?.description || '',
    stars: repoData?.stargazers_count || 0,
    language: repoData?.language || 'N/A'
  })
  
  visitedRepos.set(req.user.id, repos)

  res.json({ message: 'Visit tracked' })
})

// Most Visited Repos - Return with details
app.get('/api/most-visited', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const repos = visitedRepos.get(req.user.id) || new Map()
  const sortedRepos = Array.from(repos.values())
    .sort((a, b) => b.lastVisited - a.lastVisited) // Sort by most recent
    .slice(0, 10)

  res.json({ repos: sortedRepos })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})