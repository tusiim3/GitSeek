require('./setup')
const { test, describe, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { buildSearchQuery, parsePage, searchRepos, SearchError } = require('../github')

describe('buildSearchQuery', () => {
  const now = new Date('2026-03-15T12:00:00Z')

  test('trims plain text', () => {
    assert.equal(buildSearchQuery('  react  '), 'react')
  })

  test('adds quoted language qualifiers', () => {
    assert.equal(
      buildSearchQuery('engine', ['C++', 'C#']),
      'engine language:"C++" language:"C#"'
    )
  })

  test('adds a pushed date for date filters', () => {
    assert.equal(buildSearchQuery('x', [], 'week', now), 'x pushed:>=2026-03-08')
    assert.equal(buildSearchQuery('x', [], 'year', now), 'x pushed:>=2025-03-15')
    assert.equal(buildSearchQuery('x', [], 'all', now), 'x')
  })

  test('rejects empty, too long and unknown input', () => {
    assert.throws(() => buildSearchQuery('   '), SearchError)
    assert.throws(() => buildSearchQuery(undefined), SearchError)
    assert.throws(() => buildSearchQuery('a'.repeat(257)), SearchError)
    assert.throws(() => buildSearchQuery('x', ['Cobol']), /Unsupported language/)
    assert.throws(() => buildSearchQuery('x', [], 'decade'), /Unsupported date filter/)
  })
})

describe('parsePage', () => {
  test('defaults to 1 and accepts valid pages', () => {
    assert.equal(parsePage(undefined), 1)
    assert.equal(parsePage('3'), 3)
    assert.equal(parsePage('34'), 34)
  })

  test('rejects out-of-range or non-numeric pages', () => {
    for (const bad of ['0', '35', '2.5', 'abc', '-1']) {
      assert.throws(() => parsePage(bad), SearchError, bad)
    }
  })
})

describe('searchRepos', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  function mockFetch(status, body, headers = {}) {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url, options })
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        json: async () => body
      }
    }
    return calls
  }

  test('returns trimmed results and prefers the user token', async () => {
    const calls = mockFetch(200, {
      total_count: 1,
      items: [{ id: 1, full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'd',
        stargazers_count: 5, forks_count: 2, language: 'Go', private: true, owner: { login: 'a' } }]
    })

    const result = await searchRepos({ query: 'b', page: 2, userToken: 'user', serverToken: 'server' })

    assert.deepEqual(result, {
      total_count: 1,
      current_page: 2,
      items: [{ id: 1, full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'd',
        stargazers_count: 5, forks_count: 2, language: 'Go', private: true }]
    })
    assert.equal(calls[0].options.headers.Authorization, 'Bearer user')
    assert.match(calls[0].url, /page=2/)
  })

  test('falls back to the server token, then to no token', async () => {
    let calls = mockFetch(200, { total_count: 0, items: [] })
    await searchRepos({ query: 'x', page: 1, serverToken: 'server' })
    assert.equal(calls[0].options.headers.Authorization, 'Bearer server')

    calls = mockFetch(200, { total_count: 0, items: [] })
    await searchRepos({ query: 'x', page: 1 })
    assert.equal(calls[0].options.headers.Authorization, undefined)
  })

  test('maps GitHub errors to helpful statuses', async () => {
    mockFetch(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30) })
    await assert.rejects(searchRepos({ query: 'x', page: 1 }), (err) => {
      assert.equal(err.status, 429)
      assert.match(err.message, /Try again in \d+ seconds\. Logging in/)
      return true
    })

    mockFetch(422, {})
    await assert.rejects(searchRepos({ query: 'x', page: 1 }), { status: 400 })

    mockFetch(401, {})
    await assert.rejects(searchRepos({ query: 'x', page: 1, userToken: 't' }), { status: 401 })

    mockFetch(500, {})
    await assert.rejects(searchRepos({ query: 'x', page: 1 }), { status: 502 })
  })

  test('reports network failures as 502', async () => {
    global.fetch = async () => {
      throw new Error('ECONNRESET')
    }
    await assert.rejects(searchRepos({ query: 'x', page: 1 }), { status: 502 })
  })
})
