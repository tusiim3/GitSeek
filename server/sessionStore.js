const crypto = require('crypto')
const session = require('express-session')

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000

/**
 * express-session store backed by better-sqlite3.
 *
 * Session data (which includes the user's GitHub access token) is encrypted
 * with AES-256-GCM before it is written, so the database never holds tokens
 * in plain text. The key is derived from SESSION_SECRET.
 */
class SqliteSessionStore extends session.Store {
  constructor({ db, secret }) {
    super()
    this.key = crypto.scryptSync(secret, 'gitseek-session-store', 32)

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid     TEXT PRIMARY KEY,
        data    TEXT NOT NULL,
        expires INTEGER NOT NULL
      )
    `)

    this.statements = {
      get: db.prepare('SELECT data FROM user_sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare(`
        INSERT INTO user_sessions (sid, data, expires) VALUES (?, ?, ?)
        ON CONFLICT (sid) DO UPDATE SET data = excluded.data, expires = excluded.expires
      `),
      touch: db.prepare('UPDATE user_sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM user_sessions WHERE sid = ?'),
      clearExpired: db.prepare('DELETE FROM user_sessions WHERE expires <= ?')
    }

    this.clearExpired()
    this.cleanupTimer = setInterval(() => this.clearExpired(), CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref()
  }

  encrypt(sess) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(sess), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
  }

  decrypt(data) {
    const raw = Buffer.from(data, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const decrypted = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
    return JSON.parse(decrypted.toString('utf8'))
  }

  expiryOf(sess) {
    const expires = sess?.cookie?.expires
    return expires ? new Date(expires).getTime() : Date.now() + ONE_DAY_MS
  }

  get(sid, callback) {
    try {
      const row = this.statements.get.get(sid, Date.now())
      if (!row) return callback(null, null)
      callback(null, this.decrypt(row.data))
    } catch {
      // Unreadable data (e.g. SESSION_SECRET changed): treat as no session
      callback(null, null)
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      this.statements.set.run(sid, this.encrypt(sess), this.expiryOf(sess))
      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      this.statements.touch.run(this.expiryOf(sess), sid)
      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.statements.destroy.run(sid)
      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  clearExpired() {
    this.statements.clearExpired.run(Date.now())
  }
}

module.exports = SqliteSessionStore
