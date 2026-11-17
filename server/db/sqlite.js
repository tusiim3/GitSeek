const Database = require('better-sqlite3')
const { MAX_REPOS_PER_USER, MAX_SEARCHES_PER_USER, VISIT_MAX_AGE_MS, toLanguageKey, toSearch } = require('./shared')

/**
 * SQLite implementation of the database interface (see db/index.js).
 * Used for local development. better-sqlite3 is synchronous; the functions
 * are async only so both backends share one interface.
 */
function createSqliteDb(databasePath) {
  const db = new Database(databasePath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')

  async function init() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS visited_repos (
        user_id     TEXT NOT NULL,
        repo_url    TEXT NOT NULL,
        repo_name   TEXT NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1,
        last_visited INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        stars       INTEGER NOT NULL DEFAULT 0,
        language    TEXT NOT NULL DEFAULT 'N/A',
        PRIMARY KEY (user_id, repo_url)
      );

      CREATE TABLE IF NOT EXISTS recent_searches (
        user_id     TEXT NOT NULL,
        query       TEXT NOT NULL,
        languages   TEXT NOT NULL DEFAULT '',
        date_filter TEXT NOT NULL DEFAULT 'all',
        searched_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, query, languages, date_filter)
      );

      CREATE TABLE IF NOT EXISTS remember_preferences (
        user_id     TEXT PRIMARY KEY,
        needs_prompt INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        sid     TEXT PRIMARY KEY,
        data    TEXT NOT NULL,
        expires INTEGER NOT NULL
      );
    `)
  }

  // --- visited_repos ---

  const upsertVisitTx = db.transaction((userId, repoUrl, repoName, repoData) => {
    // Delete stale entries for this user first
    db.prepare(`DELETE FROM visited_repos WHERE user_id = ? AND last_visited < ?`)
      .run(userId, Date.now() - VISIT_MAX_AGE_MS)

    db.prepare(`
      INSERT INTO visited_repos (user_id, repo_url, repo_name, visit_count, last_visited, description, stars, language)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (user_id, repo_url) DO UPDATE SET
        visit_count  = visited_repos.visit_count + 1,
        last_visited = excluded.last_visited,
        description  = excluded.description,
        stars        = excluded.stars,
        language     = excluded.language
    `).run(
      userId,
      repoUrl,
      repoName,
      Date.now(),
      repoData?.description || '',
      repoData?.stargazers_count || 0,
      repoData?.language || 'N/A'
    )

    // Enforce the per-user cap: delete the oldest beyond the limit
    db.prepare(`
      DELETE FROM visited_repos
      WHERE user_id = ? AND repo_url NOT IN (
        SELECT repo_url FROM visited_repos
        WHERE user_id = ?
        ORDER BY last_visited DESC
        LIMIT ?
      )
    `).run(userId, userId, MAX_REPOS_PER_USER)
  })

  async function upsertVisit(userId, repoUrl, repoName, repoData) {
    upsertVisitTx(userId, repoUrl, repoName, repoData)
  }

  // Most recently visited first
  async function getRecentRepos(userId, limit = 10) {
    return db.prepare(`
      SELECT repo_url AS url, repo_name AS name, visit_count AS count,
             last_visited AS lastVisited, description, stars, language
      FROM visited_repos
      WHERE user_id = ?
      ORDER BY last_visited DESC
      LIMIT ?
    `).all(userId, limit)
  }

  // --- recent_searches ---

  // Re-searching moves an entry to the top: it is deleted and re-inserted so that
  // rowid (the tie-breaker for searches in the same millisecond) follows recency.
  const addRecentSearchTx = db.transaction((userId, query, languages, dateFilter) => {
    db.prepare(`
      DELETE FROM recent_searches
      WHERE user_id = ? AND query = ? AND languages = ? AND date_filter = ?
    `).run(userId, query, languages, dateFilter)

    db.prepare(`
      INSERT INTO recent_searches (user_id, query, languages, date_filter, searched_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, query, languages, dateFilter, Date.now())

    // Keep only the newest searches
    db.prepare(`
      DELETE FROM recent_searches
      WHERE user_id = ? AND rowid NOT IN (
        SELECT rowid FROM recent_searches
        WHERE user_id = ?
        ORDER BY searched_at DESC, rowid DESC
        LIMIT ?
      )
    `).run(userId, userId, MAX_SEARCHES_PER_USER)
  })

  async function addRecentSearch(userId, query, languages = [], dateFilter = 'all') {
    addRecentSearchTx(userId, query, toLanguageKey(languages), dateFilter)
  }

  async function getRecentSearches(userId) {
    return db.prepare(`
      SELECT query, languages, date_filter AS dateFilter
      FROM recent_searches
      WHERE user_id = ?
      ORDER BY searched_at DESC, rowid DESC
    `).all(userId).map(toSearch)
  }

  async function clearRecentSearches(userId) {
    db.prepare(`DELETE FROM recent_searches WHERE user_id = ?`).run(userId)
  }

  // --- remember_preferences ---

  async function setNeedsPrompt(userId) {
    db.prepare(`
      INSERT INTO remember_preferences (user_id, needs_prompt)
      VALUES (?, 1)
      ON CONFLICT (user_id) DO UPDATE SET needs_prompt = 1
    `).run(userId)
  }

  async function getNeedsPrompt(userId) {
    const row = db.prepare(
      `SELECT needs_prompt FROM remember_preferences WHERE user_id = ?`
    ).get(userId)
    return row ? row.needs_prompt === 1 : false
  }

  async function clearNeedsPrompt(userId) {
    db.prepare(
      `UPDATE remember_preferences SET needs_prompt = 0 WHERE user_id = ?`
    ).run(userId)
  }

  // --- user_sessions (rows are encrypted by sessionStore.js) ---

  async function getSession(sid, now) {
    const row = db.prepare('SELECT data FROM user_sessions WHERE sid = ? AND expires > ?').get(sid, now)
    return row ? row.data : null
  }

  async function setSession(sid, data, expires) {
    db.prepare(`
      INSERT INTO user_sessions (sid, data, expires) VALUES (?, ?, ?)
      ON CONFLICT (sid) DO UPDATE SET data = excluded.data, expires = excluded.expires
    `).run(sid, data, expires)
  }

  async function touchSession(sid, expires) {
    db.prepare('UPDATE user_sessions SET expires = ? WHERE sid = ?').run(expires, sid)
  }

  async function destroySession(sid) {
    db.prepare('DELETE FROM user_sessions WHERE sid = ?').run(sid)
  }

  async function clearExpiredSessions(now) {
    db.prepare('DELETE FROM user_sessions WHERE expires <= ?').run(now)
  }

  async function close() {
    db.close()
  }

  return {
    kind: 'sqlite',
    init,
    upsertVisit,
    getRecentRepos,
    addRecentSearch,
    getRecentSearches,
    clearRecentSearches,
    setNeedsPrompt,
    getNeedsPrompt,
    clearNeedsPrompt,
    getSession,
    setSession,
    touchSession,
    destroySession,
    clearExpiredSessions,
    close,
    // Direct handle, for tests that inspect raw rows
    raw: db
  }
}

module.exports = { createSqliteDb }
