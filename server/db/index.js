const config = require('../config')

/**
 * The app's database. Every function is async and behaves the same on each
 * backend, so the rest of the server doesn't care which one is active:
 *
 *   init()                                    create tables if missing
 *   upsertVisit(userId, url, name, data)      record a repo visit
 *   getRecentRepos(userId, limit)             most recently visited first
 *   addRecentSearch(userId, q, langs, date)   remember a search (keeps 10)
 *   getRecentSearches(userId)                 newest first
 *   clearRecentSearches(userId)
 *   setNeedsPrompt / getNeedsPrompt / clearNeedsPrompt(userId)
 *   getSession / setSession / touchSession / destroySession / clearExpiredSessions
 *   close()
 */
function createDb() {
  if (config.databaseUrl) {
    // Loaded only when needed, so local development doesn't touch pg at all
    const { createPostgresDb } = require('./postgres')
    return createPostgresDb(config.databaseUrl, {
      onError: (err) => console.error('Postgres connection error:', err.message)
    })
  }
  const { createSqliteDb } = require('./sqlite')
  return createSqliteDb(config.databasePath)
}

// DATABASE_URL set → Postgres (production, e.g. Neon); otherwise SQLite (local dev)
module.exports = createDb()
