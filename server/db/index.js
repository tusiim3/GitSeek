const config = require('../config')
const { createSqliteDb } = require('./sqlite')

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
module.exports = createSqliteDb(config.databasePath)
