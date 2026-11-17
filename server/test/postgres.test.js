// Runs the database and session store suites against a real Postgres server.
// Set TEST_DATABASE_URL to enable them, e.g.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
// Each run works in its own temporary schema, which is dropped afterwards,
// so existing tables in that database are never touched.
require('./setup')
const { Pool } = require('pg')
const { describeDb } = require('./dbSuite')
const { describeStore } = require('./storeSuite')
const { createPostgresDb } = require('../db/postgres')

const baseUrl = process.env.TEST_DATABASE_URL
const skip = baseUrl ? false : 'set TEST_DATABASE_URL to run the Postgres tests'

let schemaCount = 0

async function createTestDb() {
  const schema = `gitseek_test_${process.pid}_${++schemaCount}`
  const admin = new Pool({ connectionString: baseUrl, max: 1 })
  await admin.query(`CREATE SCHEMA ${schema}`)

  const url = new URL(baseUrl)
  url.searchParams.set('options', `-c search_path=${schema}`)
  const db = createPostgresDb(url.toString())

  const close = db.close
  db.close = async () => {
    await close()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
  return db
}

describeDb('postgres', createTestDb, { skip })
describeStore('postgres', createTestDb, { skip })
