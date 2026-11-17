// Behaviour every database backend must have. Each *.test.js file runs this
// against a backend: describeDb('sqlite', () => createSqliteDb(':memory:'))
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')

function describeDb(name, createDb, options = {}) {
  describe(`database (${name})`, options, () => {
    let db

    before(async () => {
      db = await createDb()
      await db.init()
    })

    after(async () => {
      await db?.close()
    })

    test('init can run again on an existing database', async () => {
      await db.init()
    })

    describe('recent searches', () => {
      test('stores searches newest first with their filters', async () => {
        await db.addRecentSearch('u1', 'react', ['TypeScript'], 'month')
        await db.addRecentSearch('u1', 'vue')
        assert.deepEqual(await db.getRecentSearches('u1'), [
          { query: 'vue', languages: [], dateFilter: 'all' },
          { query: 'react', languages: ['TypeScript'], dateFilter: 'month' }
        ])
      })

      test('treats the same filters in any order as one search', async () => {
        await db.addRecentSearch('u2', 'engine', ['Rust', 'Go'])
        await db.addRecentSearch('u2', 'engine', ['Go', 'Rust'])
        assert.equal((await db.getRecentSearches('u2')).length, 1)
      })

      test('re-searching moves a search back to the top', async () => {
        await db.addRecentSearch('u6', 'first')
        await db.addRecentSearch('u6', 'second')
        await db.addRecentSearch('u6', 'first')
        assert.deepEqual((await db.getRecentSearches('u6')).map((s) => s.query), ['first', 'second'])
      })

      test('keeps only the 10 newest per user', async () => {
        for (let i = 0; i < 15; i++) {
          await db.addRecentSearch('u3', `query ${i}`)
        }
        const searches = await db.getRecentSearches('u3')
        assert.equal(searches.length, 10)
        assert.equal(searches[0].query, 'query 14')
        assert.equal(searches[9].query, 'query 5')
      })

      test('clearing only affects that user', async () => {
        await db.addRecentSearch('u4', 'mine')
        await db.addRecentSearch('u5', 'theirs')
        await db.clearRecentSearches('u4')
        assert.equal((await db.getRecentSearches('u4')).length, 0)
        assert.equal((await db.getRecentSearches('u5')).length, 1)
      })
    })

    describe('visited repos', () => {
      test('counts repeat visits and lists the most recent first', async () => {
        await db.upsertVisit('v1', 'https://github.com/a/one', 'a/one', { stargazers_count: 3 })
        await db.upsertVisit('v1', 'https://github.com/a/two', 'a/two', {})
        await db.upsertVisit('v1', 'https://github.com/a/one', 'a/one', { stargazers_count: 4, language: 'Go' })

        const repos = await db.getRecentRepos('v1')
        assert.deepEqual(repos.map((r) => [r.name, r.count]), [['a/one', 2], ['a/two', 1]])
        assert.equal(repos[0].stars, 4)
        assert.equal(repos[0].language, 'Go')
        assert.equal(repos[1].language, 'N/A')
        assert.equal(typeof repos[0].lastVisited, 'number')
      })

      test('keeps at most 50 repos per user', async () => {
        for (let i = 0; i < 55; i++) {
          await db.upsertVisit('v2', `https://github.com/a/r${i}`, `a/r${i}`, {})
        }
        assert.equal((await db.getRecentRepos('v2', 100)).length, 50)
      })
    })

    describe('remember-me prompt', () => {
      test('is shown after login until the user answers', async () => {
        assert.equal(await db.getNeedsPrompt('p1'), false)
        await db.setNeedsPrompt('p1')
        assert.equal(await db.getNeedsPrompt('p1'), true)
        await db.clearNeedsPrompt('p1')
        assert.equal(await db.getNeedsPrompt('p1'), false)
        await db.setNeedsPrompt('p1')
        assert.equal(await db.getNeedsPrompt('p1'), true)
      })
    })

    describe('session rows', () => {
      test('store, expire, touch and delete', async () => {
        const now = Date.now()
        await db.setSession('s1', 'data-1', now + 60_000)
        assert.equal(await db.getSession('s1', now), 'data-1')

        await db.setSession('s1', 'data-2', now + 60_000)
        assert.equal(await db.getSession('s1', now), 'data-2')

        assert.equal(await db.getSession('s1', now + 120_000), null, 'expired rows are not returned')
        await db.touchSession('s1', now + 300_000)
        assert.equal(await db.getSession('s1', now + 120_000), 'data-2')

        await db.setSession('old', 'x', now - 1)
        await db.clearExpiredSessions(now)
        assert.equal(await db.getSession('old', now - 10), null)

        await db.destroySession('s1')
        assert.equal(await db.getSession('s1', now), null)
      })
    })
  })
}

module.exports = { describeDb }
