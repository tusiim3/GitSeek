const { Pool, types } = require('pg')
const { MAX_REPOS_PER_USER, MAX_SEARCHES_PER_USER, VISIT_MAX_AGE_MS, toLanguageKey, toSearch } = require('./shared')

const INT8_OID = 20

// Timestamps are stored as BIGINT milliseconds. pg returns BIGINT as a string
// by default; millisecond timestamps and counts fit safely in a JS number.
const typeParsers = {
  getTypeParser(oid, format) {
    if (oid === INT8_OID) return (value) => Number(value)
    return types.getTypeParser(oid, format)
  }
}

/**
 * Postgres implementation of the database interface (see db/index.js).
 * Used in production with Neon, where DATABASE_URL is the connection string.
 */
function createPostgresDb(connectionString, { onError = () => {} } = {}) {
  const pool = new Pool({
    connectionString,
    types: typeParsers,
    max: 5,
    idleTimeoutMillis: 30_000,
    // Neon pauses idle databases; waking one takes a moment
    connectionTimeoutMillis: 15_000
  })

  // An idle connection dropped by the server must not crash the app
  pool.on('error', onError)

  const query = (text, params) => pool.query(text, params)

  async function transaction(fn) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  async function init() {
    await query(`
      CREATE TABLE IF NOT EXISTS visited_repos (
        user_id      TEXT NOT NULL,
        repo_url     TEXT NOT NULL,
        repo_name    TEXT NOT NULL,
        visit_count  INTEGER NOT NULL DEFAULT 1,
        last_visited BIGINT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        stars        INTEGER NOT NULL DEFAULT 0,
        language     TEXT NOT NULL DEFAULT 'N/A',
        PRIMARY KEY (user_id, repo_url)
      );

      CREATE TABLE IF NOT EXISTS recent_searches (
        id          BIGSERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL,
        query       TEXT NOT NULL,
        languages   TEXT NOT NULL DEFAULT '',
        date_filter TEXT NOT NULL DEFAULT 'all',
        searched_at BIGINT NOT NULL,
        UNIQUE (user_id, query, languages, date_filter)
      );

      CREATE TABLE IF NOT EXISTS remember_preferences (
        user_id      TEXT PRIMARY KEY,
        needs_prompt INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        sid     TEXT PRIMARY KEY,
        data    TEXT NOT NULL,
        expires BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions (expires);
    `)
  }

  // --- visited_repos ---

  async function upsertVisit(userId, repoUrl, repoName, repoData) {
    await transaction(async (client) => {
      // Delete stale entries for this user first
      await client.query(
        'DELETE FROM visited_repos WHERE user_id = $1 AND last_visited < $2',
        [userId, Date.now() - VISIT_MAX_AGE_MS]
      )

      await client.query(`
        INSERT INTO visited_repos (user_id, repo_url, repo_name, visit_count, last_visited, description, stars, language)
        VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
        ON CONFLICT (user_id, repo_url) DO UPDATE SET
          visit_count  = visited_repos.visit_count + 1,
          last_visited = EXCLUDED.last_visited,
          description  = EXCLUDED.description,
          stars        = EXCLUDED.stars,
          language     = EXCLUDED.language
      `, [
        userId,
        repoUrl,
        repoName,
        Date.now(),
        repoData?.description || '',
        repoData?.stargazers_count || 0,
        repoData?.language || 'N/A'
      ])

      // Enforce the per-user cap: delete the oldest beyond the limit
      await client.query(`
        DELETE FROM visited_repos
        WHERE user_id = $1 AND repo_url NOT IN (
          SELECT repo_url FROM visited_repos
          WHERE user_id = $1
          ORDER BY last_visited DESC
          LIMIT $2
        )
      `, [userId, MAX_REPOS_PER_USER])
    })
  }

  // Most recently visited first
  async function getRecentRepos(userId, limit = 10) {
    const { rows } = await query(`
      SELECT repo_url AS url, repo_name AS name, visit_count AS count,
             last_visited AS "lastVisited", description, stars, language
      FROM visited_repos
      WHERE user_id = $1
      ORDER BY last_visited DESC
      LIMIT $2
    `, [userId, limit])
    return rows
  }

  // --- recent_searches ---

  // Re-searching moves an entry to the top: it is deleted and re-inserted so that
  // id (the tie-breaker for searches in the same millisecond) follows recency.
  async function addRecentSearch(userId, query, languages = [], dateFilter = 'all') {
    const languageKey = toLanguageKey(languages)
    await transaction(async (client) => {
      await client.query(`
        DELETE FROM recent_searches
        WHERE user_id = $1 AND query = $2 AND languages = $3 AND date_filter = $4
      `, [userId, query, languageKey, dateFilter])

      await client.query(`
        INSERT INTO recent_searches (user_id, query, languages, date_filter, searched_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, query, languages, date_filter) DO UPDATE SET
          searched_at = EXCLUDED.searched_at
      `, [userId, query, languageKey, dateFilter, Date.now()])

      // Keep only the newest searches
      await client.query(`
        DELETE FROM recent_searches
        WHERE user_id = $1 AND id NOT IN (
          SELECT id FROM recent_searches
          WHERE user_id = $1
          ORDER BY searched_at DESC, id DESC
          LIMIT $2
        )
      `, [userId, MAX_SEARCHES_PER_USER])
    })
  }

  async function getRecentSearches(userId) {
    const { rows } = await query(`
      SELECT query, languages, date_filter AS "dateFilter"
      FROM recent_searches
      WHERE user_id = $1
      ORDER BY searched_at DESC, id DESC
    `, [userId])
    return rows.map(toSearch)
  }

  async function clearRecentSearches(userId) {
    await query('DELETE FROM recent_searches WHERE user_id = $1', [userId])
  }

  // --- remember_preferences ---

  async function setNeedsPrompt(userId) {
    await query(`
      INSERT INTO remember_preferences (user_id, needs_prompt)
      VALUES ($1, 1)
      ON CONFLICT (user_id) DO UPDATE SET needs_prompt = 1
    `, [userId])
  }

  async function getNeedsPrompt(userId) {
    const { rows } = await query(
      'SELECT needs_prompt FROM remember_preferences WHERE user_id = $1',
      [userId]
    )
    return rows.length > 0 && rows[0].needs_prompt === 1
  }

  async function clearNeedsPrompt(userId) {
    await query('UPDATE remember_preferences SET needs_prompt = 0 WHERE user_id = $1', [userId])
  }

  // --- user_sessions (rows are encrypted by sessionStore.js) ---

  async function getSession(sid, now) {
    const { rows } = await query(
      'SELECT data FROM user_sessions WHERE sid = $1 AND expires > $2',
      [sid, now]
    )
    return rows.length > 0 ? rows[0].data : null
  }

  async function setSession(sid, data, expires) {
    await query(`
      INSERT INTO user_sessions (sid, data, expires) VALUES ($1, $2, $3)
      ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires
    `, [sid, data, expires])
  }

  async function touchSession(sid, expires) {
    await query('UPDATE user_sessions SET expires = $1 WHERE sid = $2', [expires, sid])
  }

  async function destroySession(sid) {
    await query('DELETE FROM user_sessions WHERE sid = $1', [sid])
  }

  async function clearExpiredSessions(now) {
    await query('DELETE FROM user_sessions WHERE expires <= $1', [now])
  }

  async function close() {
    await pool.end()
  }

  return {
    kind: 'postgres',
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
    // Direct handle, for tests
    pool
  }
}

module.exports = { createPostgresDb }
