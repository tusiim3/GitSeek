// Load env files before anything else reads process.env. Values already in
// the real environment (e.g. Render's env vars) always win; between the files,
// the first one to set a variable wins:
//   1. .env.local at the repo root, written by `neon deploy` / `neon env pull`
//   2. server/.env, your own local settings
const path = require('path')
const dotenv = require('dotenv')
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true })
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true })

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
  // Public URL the app is reached at (used to build the OAuth callback URL)
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  sessionSecret: process.env.SESSION_SECRET,
  // Optional token for searches by visitors who are not logged in
  githubToken: process.env.GITHUB_TOKEN || undefined,
  // Postgres connection string (e.g. Neon). Empty or unset means SQLite is used.
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  // SQLite file. Relative paths are resolved from the server folder, not the shell's cwd
  databasePath: dbPath === ':memory:' ? dbPath : path.resolve(__dirname, dbPath)
}
