require('./setup')
const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const SqliteSessionStore = require('../sessionStore')

function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (err, value) => (err ? reject(err) : resolve(value)))
  })
}

function sessionExpiringIn(ms, extra = {}) {
  return { cookie: { expires: new Date(Date.now() + ms).toISOString() }, ...extra }
}

describe('SqliteSessionStore', () => {
  let db
  let store

  beforeEach(() => {
    db = new Database(':memory:')
    store = new SqliteSessionStore({ db, secret: 'secret-one' })
  })

  afterEach(() => {
    clearInterval(store.cleanupTimer)
    db.close()
  })

  test('round-trips session data', async () => {
    const sess = sessionExpiringIn(60_000, { passport: { user: { id: '1', accessToken: 'gho_abc' } } })
    await call(store, 'set', 'sid1', sess)
    assert.deepEqual(await call(store, 'get', 'sid1'), sess)
  })

  test('encrypts data at rest', async () => {
    await call(store, 'set', 'sid1', sessionExpiringIn(60_000, { token: 'gho_super_secret' }))
    const raw = db.prepare('SELECT data FROM user_sessions WHERE sid = ?').get('sid1').data
    assert.ok(!raw.includes('gho_super_secret'))
  })

  test('ignores sessions written with a different secret', async () => {
    await call(store, 'set', 'sid1', sessionExpiringIn(60_000))
    const other = new SqliteSessionStore({ db, secret: 'secret-two' })
    clearInterval(other.cleanupTimer)
    assert.equal(await call(other, 'get', 'sid1'), null)
  })

  test('treats expired sessions as missing and clears them', async () => {
    await call(store, 'set', 'old', sessionExpiringIn(-1000))
    assert.equal(await call(store, 'get', 'old'), null)
    store.clearExpired()
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0)
  })

  test('touch extends expiry and destroy removes the session', async () => {
    await call(store, 'set', 'sid1', sessionExpiringIn(1000))
    const later = sessionExpiringIn(3_600_000)
    await call(store, 'touch', 'sid1', later)
    const { expires } = db.prepare('SELECT expires FROM user_sessions WHERE sid = ?').get('sid1')
    assert.equal(expires, new Date(later.cookie.expires).getTime())

    await call(store, 'destroy', 'sid1')
    assert.equal(await call(store, 'get', 'sid1'), null)
  })
})
