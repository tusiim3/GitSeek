// Load .env before anything else reads process.env
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true })

const required = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']
const missing = required.filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`)
  console.error('Copy .env.example to server/.env and fill in the values.')
  process.exit(1)
}

const dbPath = process.env.DATABASE_PATH || 'gitseek.db'

module.exports = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT) || 5000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:5000',
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  sessionSecret: process.env.SESSION_SECRET,
  // Relative paths are resolved from the server folder, not the shell's cwd
  databasePath: dbPath === ':memory:' ? dbPath : path.resolve(__dirname, dbPath)
}
