// Startup checks in config.js, run in a child process because they exit it
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

function loadConfig(databaseUrl) {
  return spawnSync(process.execPath, ['-e', "require('./config')"], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GITHUB_CLIENT_ID: 'x',
      GITHUB_CLIENT_SECRET: 'y',
      SESSION_SECRET: 'z',
      DATABASE_URL: databaseUrl
    }
  })
}

test('rejects a malformed DATABASE_URL without printing it', () => {
  for (const bad of ["psql 'postgresql://u:secretpw@host/db'", 'ep-host.neon.tech/db', 'mysql://u:secretpw@host/db']) {
    const result = loadConfig(bad)
    assert.equal(result.status, 1, bad)
    assert.match(result.stderr, /DATABASE_URL is not a valid Postgres connection string/)
    assert.ok(!result.stderr.includes('secretpw'), 'the value must not be printed')
  }
})

test('accepts postgres URLs and an empty value', () => {
  for (const good of ['postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require', 'postgres://u@localhost:5432/db', '']) {
    assert.equal(loadConfig(good).status, 0, good)
  }
})
