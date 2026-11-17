// Behaviour of the encrypted session store on top of any database backend
const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const EncryptedSessionStore = require('../sessionStore')

function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (err, value) => (err ? reject(err) : resolve(value)))
  })
}

function sessionExpiringIn(ms, extra = {}) {
  return { cookie: { expires: new Date(Date.now() + ms).toISOString() }, ...extra }
}

// Runs the store tests on top of a database backend
function describeStore(name, createDb, options = {}) {
  describe(`EncryptedSessionStore (${name})`, options, () => {
    let db
    const stores = []

    function makeStore(secret = 'secret-one') {
      const store = new EncryptedSessionStore({ db, secret })
      stores.push(store)
      return store
    }

    before(async () => {
      db = await createDb()
      await db.init()
    })

    after(async () => {
      stores.forEach((store) => clearInterval(store.cleanupTimer))
      await db?.close()
    })

    test('round-trips session data', async () => {
      const store = makeStore()
      const sess = sessionExpiringIn(60_000, { passport: { user: { id: '1', accessToken: 'gho_abc' } } })
      await call(store, 'set', 'rt', sess)
      assert.deepEqual(await call(store, 'get', 'rt'), sess)
    })

    test('encrypts data at rest', async () => {
      const store = makeStore()
      await call(store, 'set', 'enc', sessionExpiringIn(60_000, { token: 'gho_super_secret' }))
      const raw = await db.getSession('enc', Date.now())
      assert.ok(raw)
      assert.ok(!raw.includes('gho_super_secret'))
    })

    test('ignores sessions written with a different secret', async () => {
      await call(makeStore('secret-one'), 'set', 'other', sessionExpiringIn(60_000))
      assert.equal(await call(makeStore('secret-two'), 'get', 'other'), null)
    })

    test('treats expired sessions as missing', async () => {
      const store = makeStore()
      await call(store, 'set', 'old', sessionExpiringIn(-1000))
      assert.equal(await call(store, 'get', 'old'), null)
    })

    test('touch extends expiry and destroy removes the session', async () => {
      const store = makeStore()
      await call(store, 'set', 'td', sessionExpiringIn(1000))
      await call(store, 'touch', 'td', sessionExpiringIn(3_600_000))
      assert.ok(await db.getSession('td', Date.now() + 60_000), 'still valid after the original expiry')

      await call(store, 'destroy', 'td')
      assert.equal(await call(store, 'get', 'td'), null)
    })
  })
}

module.exports = { describeStore }
