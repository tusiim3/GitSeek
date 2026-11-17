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
const databaseUrl = process.env.DATABASE_URL?.trim() || undefined

// A malformed DATABASE_URL otherwise fails later with a confusing DNS error
// (pg resolves it against a placeholder host called "base"). Never log the value.
if (databaseUrl && !isPostgresUrl(databaseUrl)) {
  console.error('DATABASE_URL is not a valid Postgres connection string.')
  console.error('It must start with postgres:// or postgresql://. Paste the bare connection')
  console.error("string, without a leading 'psql', quotes or spaces.")
  process.exit(1)
}

function parseHops(value, fallback) {
  if (value === undefined || value.trim() === '') return fallback
  const hops = Number(value)
  if (!Number.isInteger(hops) || hops < 0) {
    console.error('TRUST_PROXY_HOPS must be a whole number (0 or more).')
    process.exit(1)
  }
  return hops
}

function isPostgresUrl(value) {
  try {
    const url = new URL(value)
    return (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname !== ''
  } catch {
    return false
  }
}

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
  // Proxies in front of the app (see app.js). Defaults to Render's 3 in production.
  trustProxyHops: parseHops(process.env.TRUST_PROXY_HOPS, process.env.NODE_ENV === 'production' ? 3 : 0),
  // Postgres connection string (e.g. Neon). Empty or unset means SQLite is used.
  databaseUrl,
  // SQLite file. Relative paths are resolved from the server folder, not the shell's cwd
  databasePath: dbPath === ':memory:' ? dbPath : path.resolve(__dirname, dbPath)
}
