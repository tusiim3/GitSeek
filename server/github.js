const PER_PAGE = 30
// GitHub only returns the first 1,000 results of a search
const MAX_PAGE = Math.ceil(1000 / PER_PAGE)
const MAX_QUERY_LENGTH = 256

const LANGUAGES = [
  'JavaScript', 'Python', 'Java', 'TypeScript', 'C++', 'C#', 'PHP', 'Ruby',
  'Go', 'Rust', 'Swift', 'Kotlin', 'Dart', 'HTML', 'CSS'
]

const DATE_FILTER_DAYS = { week: 7, month: 30, year: 365 }

/** An error with an HTTP status and a message that is safe to show users. */
class SearchError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Turns the user's input into a GitHub search query string.
 * Throws a SearchError (400) for input GitHub would reject.
 */
function buildSearchQuery(q, languages = [], dateFilter = 'all', now = new Date()) {
  const text = typeof q === 'string' ? q.trim() : ''
  if (!text) {
    throw new SearchError(400, 'Please enter something to search for.')
  }
  if (text.length > MAX_QUERY_LENGTH) {
    throw new SearchError(400, `Search text can be at most ${MAX_QUERY_LENGTH} characters.`)
  }

  const parts = [text]

  for (const lang of languages) {
    if (!LANGUAGES.includes(lang)) {
      throw new SearchError(400, `Unsupported language filter: ${lang}`)
    }
    parts.push(`language:"${lang}"`)
  }

  if (dateFilter && dateFilter !== 'all') {
    const days = DATE_FILTER_DAYS[dateFilter]
    if (!days) {
      throw new SearchError(400, `Unsupported date filter: ${dateFilter}`)
    }
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    parts.push(`pushed:>=${since.toISOString().slice(0, 10)}`)
  }

  return parts.join(' ')
}

/** Validates a page number from the query string. */
function parsePage(value) {
  if (value === undefined || value === '') return 1
  const page = Number(value)
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new SearchError(400, `Page must be a whole number between 1 and ${MAX_PAGE}.`)
  }
  return page
}

/** Maps a failed GitHub response to a SearchError with a helpful message. */
function toSearchError(response, usedUserToken) {
  const { status, headers } = response
  const rateLimited = status === 429 || (status === 403 && headers.get('x-ratelimit-remaining') === '0')

  if (rateLimited || status === 403) {
    const retryAfter = Number(headers.get('retry-after'))
    const reset = Number(headers.get('x-ratelimit-reset'))
    let seconds = 60
    if (retryAfter > 0) seconds = retryAfter
    else if (reset > 0) seconds = Math.max(1, reset - Math.floor(Date.now() / 1000))
    const hint = usedUserToken ? '' : ' Logging in with GitHub raises the limit.'
    return new SearchError(429, `GitHub's search limit was reached. Try again in ${seconds} seconds.${hint}`)
  }
  if (status === 401) {
    return new SearchError(401, 'Your GitHub login has expired. Please log out and log in again.')
  }
  if (status === 422) {
    return new SearchError(400, 'GitHub could not run that search. Try different keywords.')
  }
  return new SearchError(502, 'GitHub search is unavailable right now. Please try again shortly.')
}

/** Keeps only the fields the frontend uses. */
function toRepo(item) {
  return {
    id: item.id,
    full_name: item.full_name,
    html_url: item.html_url,
    description: item.description,
    stargazers_count: item.stargazers_count,
    forks_count: item.forks_count,
    language: item.language,
    private: item.private
  }
}

/**
 * Searches GitHub repositories. Uses the user's token when available, else
 * the optional server token, else anonymous access (lowest rate limit).
 */
async function searchRepos({ query, page, userToken, serverToken }) {
  const token = userToken || serverToken
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GitSeek'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const params = new URLSearchParams({
    q: query,
    sort: 'stars',
    order: 'desc',
    page: String(page),
    per_page: String(PER_PAGE)
  })

  let response
  try {
    response = await fetch(`https://api.github.com/search/repositories?${params}`, {
      headers,
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new SearchError(502, 'Could not reach GitHub. Please try again shortly.')
  }

  if (!response.ok) {
    throw toSearchError(response, Boolean(userToken))
  }

  const data = await response.json()
  return {
    items: data.items.map(toRepo),
    total_count: data.total_count,
    current_page: page
  }
}

module.exports = {
  LANGUAGES,
  MAX_PAGE,
  PER_PAGE,
  SearchError,
  buildSearchQuery,
  parsePage,
  searchRepos
}
