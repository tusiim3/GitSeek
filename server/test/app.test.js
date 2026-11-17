require('./setup')
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const signature = require('cookie-signature')
const { app, db, sessionStore } = require('../app')

let server
let baseUrl
const realFetch = global.fetch

before(async () => {
  await db.init()
  await new Promise((resolve) => {
    server = app.listen(0, resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  clearInterval(sessionStore.cleanupTimer)
})

// Requests to the app itself always use the real fetch
function request(path, { cookie, ...options } = {}) {
  const headers = { ...options.headers }
  if (cookie) headers.cookie = cookie
  return realFetch(baseUrl + path, { ...options, headers, redirect: 'manual' })
}

// Creates a logged-in session directly in the store and returns its cookie
async function loginAs(id) {
  const sid = `test-session-${id}`
  await new Promise((resolve, reject) => {
    sessionStore.set(sid, {
      cookie: { expires: new Date(Date.now() + 3_600_000).toISOString(), originalMaxAge: 3_600_000, httpOnly: true, path: '/' },
      passport: { user: { id, username: `user${id}`, displayName: `User ${id}`, avatar: '', accessToken: 'gho_test' } }
    }, (err) => (err ? reject(err) : resolve()))
  })
  return `connect.sid=${encodeURIComponent('s:' + signature.sign(sid, process.env.SESSION_SECRET))}`
}

// Replaces GitHub with a canned empty result for the duration of fn
async function withGitHubStub(fn) {
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ total_count: 0, items: [] }) }
  }
  try {
    await fn()
  } finally {
    global.fetch = realFetch
  }
  return calls
}

describe('authentication', () => {
  test('protected routes require login', async () => {
    for (const [method, path] of [
      ['GET', '/api/recent-repos'],
      ['GET', '/api/recent-searches'],
      ['DELETE', '/api/recent-searches'],
      ['POST', '/api/track-visit']
    ]) {
      const res = await request(path, { method })
      assert.equal(res.status, 401, `${method} ${path}`)
    }
    assert.equal((await request('/auth/user')).status, 401)
  })

  test('login redirects to GitHub with repo scope and state', async () => {
    const res = await request('/auth/github')
    assert.equal(res.status, 302)
    const location = new URL(res.headers.get('location'))
    assert.equal(location.host, 'github.com')
    assert.equal(location.searchParams.get('scope'), 'repo')
    assert.ok(location.searchParams.get('state'))
  })

  test('returns the user for a valid session and logs out via POST only', async () => {
    const cookie = await loginAs('7')
    const me = await (await request('/auth/user', { cookie })).json()
    assert.equal(me.user.username, 'user7')
    assert.equal(me.user.accessToken, undefined, 'token must never reach the browser')

    assert.equal((await request('/auth/logout', { cookie })).status, 404)
    assert.equal((await request('/auth/logout', { method: 'POST', cookie })).status, 200)
    assert.equal((await request('/auth/user', { cookie })).status, 401)
  })
})

describe('search', () => {
  test('rejects invalid input before calling GitHub', async () => {
    const calls = await withGitHubStub(async () => {
      assert.equal((await request('/api/search')).status, 400)
      assert.equal((await request('/api/search?q=x&page=99')).status, 400)
      assert.equal((await request('/api/search?q=x&languages=Cobol')).status, 400)
    })
    assert.equal(calls.length, 0)
  })

  test('uses the user token and saves first-page searches', async () => {
    const cookie = await loginAs('8')
    const calls = await withGitHubStub(async () => {
      await request('/api/search?q=react&languages=TypeScript', { cookie })
      await request('/api/search?q=react&languages=TypeScript&page=2', { cookie })
    })
    assert.equal(calls[0].options.headers.Authorization, 'Bearer gho_test')

    const { searches } = await (await request('/api/recent-searches', { cookie })).json()
    assert.deepEqual(searches, [{ query: 'react', languages: ['TypeScript'], dateFilter: 'all' }])
  })
})

describe('visit tracking', () => {
  test('validates input and lists recent repos', async () => {
    const cookie = await loginAs('9')
    const post = (body) => request('/api/track-visit', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

    assert.equal((await post({ repoUrl: 'javascript:alert(1)', repoName: 'x' })).status, 400)
    assert.equal((await post({ repoUrl: 'https://github.com/a/b', repoName: 'a/b' })).status, 200)

    const { repos } = await (await request('/api/recent-repos', { cookie })).json()
    assert.deepEqual(repos.map((r) => r.name), ['a/b'])
  })
})

describe('frontend serving', () => {
  test('unknown API routes are not swallowed by the SPA fallback', async () => {
    const res = await request('/api/does-not-exist')
    assert.equal(res.status, 404)
  })

  test('client-side routes get index.html when the frontend is built', async (t) => {
    const fs = require('fs')
    const path = require('path')
    if (!fs.existsSync(path.join(__dirname, '..', '..', 'git-seek', 'dist'))) {
      t.skip('frontend not built')
      return
    }
    const res = await request('/some/client/route')
    assert.equal(res.status, 200)
    assert.match(await res.text(), /<div id="root">/)
  })
})
