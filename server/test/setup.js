// Shared test environment. Required first by every test file so config.js
// sees these values instead of a developer's server/.env.
process.env.NODE_ENV = 'test'
process.env.GITHUB_CLIENT_ID = 'test-client-id'
process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'
process.env.SESSION_SECRET = 'test-session-secret'
process.env.DATABASE_PATH = ':memory:'
process.env.LOG_LEVEL = 'silent'
delete process.env.GITHUB_TOKEN
