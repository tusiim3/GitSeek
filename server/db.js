const Database = require('better-sqlite3')
const path = require('path')

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'gitseek.db')
const db = new Database(dbPath)

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL')

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

  CREATE TABLE IF NOT EXISTS remember_preferences (
    user_id     TEXT PRIMARY KEY,
    needs_prompt INTEGER NOT NULL DEFAULT 1
  );
`)

const MAX_REPOS_PER_USER = 50
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// --- visited_repos helpers ---

function upsertVisit(userId, repoUrl, repoName, repoData) {
  const cutoff = Date.now() - MAX_AGE_MS

  // Delete stale entries for this user first
  db.prepare(`DELETE FROM visited_repos WHERE user_id = ? AND last_visited < ?`)
    .run(userId, cutoff)

  const existing = db.prepare(
    `SELECT visit_count FROM visited_repos WHERE user_id = ? AND repo_url = ?`
  ).get(userId, repoUrl)

  const newCount = existing ? existing.visit_count + 1 : 1

  db.prepare(`
    INSERT INTO visited_repos (user_id, repo_url, repo_name, visit_count, last_visited, description, stars, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, repo_url) DO UPDATE SET
      visit_count  = excluded.visit_count,
      last_visited = excluded.last_visited,
      description  = excluded.description,
      stars        = excluded.stars,
      language     = excluded.language
  `).run(
    userId,
    repoUrl,
    repoName,
    newCount,
    Date.now(),
    repoData?.description || '',
    repoData?.stargazers_count || 0,
    repoData?.language || 'N/A'
  )

  // Enforce 50-repo cap: delete oldest beyond limit
  const count = db.prepare(
    `SELECT COUNT(*) as cnt FROM visited_repos WHERE user_id = ?`
  ).get(userId).cnt

  if (count > MAX_REPOS_PER_USER) {
    db.prepare(`
      DELETE FROM visited_repos
      WHERE user_id = ? AND repo_url IN (
        SELECT repo_url FROM visited_repos
        WHERE user_id = ?
        ORDER BY last_visited ASC
        LIMIT ?
      )
    `).run(userId, userId, count - MAX_REPOS_PER_USER)
  }
}

function getMostVisited(userId, limit = 10) {
  return db.prepare(`
    SELECT repo_url AS url, repo_name AS name, visit_count AS count,
           last_visited AS lastVisited, description, stars, language
    FROM visited_repos
    WHERE user_id = ?
    ORDER BY last_visited DESC
    LIMIT ?
  `).all(userId, limit)
}

function deleteUserVisits(userId) {
  db.prepare(`DELETE FROM visited_repos WHERE user_id = ?`).run(userId)
}

// --- remember_preferences helpers ---

function setNeedsPrompt(userId) {
  db.prepare(`
    INSERT INTO remember_preferences (user_id, needs_prompt)
    VALUES (?, 1)
    ON CONFLICT (user_id) DO UPDATE SET needs_prompt = 1
  `).run(userId)
}

function getNeedsPrompt(userId) {
  const row = db.prepare(
    `SELECT needs_prompt FROM remember_preferences WHERE user_id = ?`
  ).get(userId)
  return row ? row.needs_prompt === 1 : false
}

function clearNeedsPrompt(userId) {
  db.prepare(
    `UPDATE remember_preferences SET needs_prompt = 0 WHERE user_id = ?`
  ).run(userId)
}

module.exports = {
  db,
  upsertVisit,
  getMostVisited,
  deleteUserVisits,
  setNeedsPrompt,
  getNeedsPrompt,
  clearNeedsPrompt
}
