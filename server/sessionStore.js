const crypto = require('crypto')
const session = require('express-session')

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000

/**
 * express-session store that saves sessions through the app's database
 * interface (SQLite or Postgres, see db/index.js).
 *
 * Session data (which includes the user's GitHub access token) is encrypted
 * with AES-256-GCM before it is written, so the database never holds tokens
 * in plain text. The key is derived from SESSION_SECRET.
 */
class EncryptedSessionStore extends session.Store {
  constructor({ db, secret }) {
    super()
    this.db = db
    this.key = crypto.scryptSync(secret, 'gitseek-session-store', 32)

    this.cleanupTimer = setInterval(() => {
      this.clearExpired().catch((err) => this.emit('error', err))
    }, CLEANUP_INTERVAL_MS)
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
    this.db.getSession(sid, Date.now()).then(
      (data) => {
        if (!data) return callback(null, null)
        try {
          callback(null, this.decrypt(data))
        } catch {
          // Unreadable data (e.g. SESSION_SECRET changed): treat as no session
          callback(null, null)
        }
      },
      (err) => callback(err)
    )
  }

  set(sid, sess, callback = () => {}) {
    let data
    try {
      data = this.encrypt(sess)
    } catch (err) {
      return callback(err)
    }
    this.db.setSession(sid, data, this.expiryOf(sess)).then(() => callback(null), callback)
  }

  touch(sid, sess, callback = () => {}) {
    this.db.touchSession(sid, this.expiryOf(sess)).then(() => callback(null), callback)
  }

  destroy(sid, callback = () => {}) {
    this.db.destroySession(sid).then(() => callback(null), callback)
  }

  clearExpired() {
    return this.db.clearExpiredSessions(Date.now())
  }
}

module.exports = EncryptedSessionStore
