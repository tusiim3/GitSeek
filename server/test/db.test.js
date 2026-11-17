require('./setup')
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const {
  upsertVisit, getRecentRepos, addRecentSearch, getRecentSearches, clearRecentSearches
} = require('../db')

describe('recent searches', () => {
  test('stores searches newest first with their filters', () => {
    addRecentSearch('u1', 'react', ['TypeScript'], 'month')
    addRecentSearch('u1', 'vue')
    assert.deepEqual(getRecentSearches('u1'), [
      { query: 'vue', languages: [], dateFilter: 'all' },
      { query: 'react', languages: ['TypeScript'], dateFilter: 'month' }
    ])
  })

  test('treats the same filters in any order as one search', () => {
    addRecentSearch('u2', 'engine', ['Rust', 'Go'])
    addRecentSearch('u2', 'engine', ['Go', 'Rust'])
    assert.equal(getRecentSearches('u2').length, 1)
  })

  test('keeps only the 10 newest per user', () => {
    for (let i = 0; i < 15; i++) {
      addRecentSearch('u3', `query ${i}`)
    }
    const searches = getRecentSearches('u3')
    assert.equal(searches.length, 10)
    assert.equal(searches[0].query, 'query 14')
    assert.equal(searches[9].query, 'query 5')
  })

  test('clearing only affects that user', () => {
    addRecentSearch('u4', 'mine')
    addRecentSearch('u5', 'theirs')
    clearRecentSearches('u4')
    assert.equal(getRecentSearches('u4').length, 0)
    assert.equal(getRecentSearches('u5').length, 1)
  })
})

describe('visited repos', () => {
  test('counts repeat visits and lists the most recent first', () => {
    upsertVisit('v1', 'https://github.com/a/one', 'a/one', { stargazers_count: 3 })
    upsertVisit('v1', 'https://github.com/a/two', 'a/two', {})
    upsertVisit('v1', 'https://github.com/a/one', 'a/one', { stargazers_count: 4 })

    const repos = getRecentRepos('v1')
    assert.deepEqual(repos.map((r) => [r.name, r.count]), [['a/one', 2], ['a/two', 1]])
    assert.equal(repos[0].stars, 4)
  })
})
