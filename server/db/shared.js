// Limits and row helpers shared by the SQLite and Postgres implementations

const MAX_REPOS_PER_USER = 50
const MAX_SEARCHES_PER_USER = 10
const VISIT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// Filters are stored as a sorted comma list so the same set in any order matches
function toLanguageKey(languages = []) {
  return [...languages].sort().join(',')
}

function toSearch(row) {
  return {
    query: row.query,
    languages: row.languages ? row.languages.split(',') : [],
    dateFilter: row.dateFilter
  }
}

module.exports = {
  MAX_REPOS_PER_USER,
  MAX_SEARCHES_PER_USER,
  VISIT_MAX_AGE_MS,
  toLanguageKey,
  toSearch
}
