// req.ip behind Render's proxies (TRUST_PROXY_HOPS), in a child process
// because the setting is read when the app is created
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

// Starts the app, sends one request with the given X-Forwarded-For and
// reports the req.ip the rate limiter would use
const script = `
const { app } = require('./app')
app.get('/api/__ip', (req, res) => res.json({ ip: req.ip }))
const server = app.listen(0, async () => {
  const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/__ip', {
    headers: { 'x-forwarded-for': process.env.XFF }
  })
  console.log(JSON.stringify(await res.json()))
  server.close()
  process.exit(0)
})`

function ipFor(xff, hops) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_CLIENT_ID: 'x',
    GITHUB_CLIENT_SECRET: 'y',
    SESSION_SECRET: 'z',
    DATABASE_URL: '',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'production',
    XFF: xff
  }
  if (hops !== undefined) env.TRUST_PROXY_HOPS = hops
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', env
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout.trim().split('\n').pop()).ip
}

// The chain Render's logs show: visitor, Cloudflare, Render load balancer
const renderChain = '35.197.36.229, 172.71.150.12, 10.193.67.84'

test('in production req.ip is the visitor behind Render\'s 3 proxies', () => {
  assert.equal(ipFor(renderChain), '35.197.36.229')
})

test('a spoofed X-Forwarded-For entry from the visitor is not trusted', () => {
  assert.equal(ipFor('6.6.6.6, ' + renderChain), '35.197.36.229')
})

test('TRUST_PROXY_HOPS overrides the default', () => {
  assert.equal(ipFor(renderChain, '1'), '10.193.67.84')
})
