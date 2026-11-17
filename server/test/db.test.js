require('./setup')
const { describeDb } = require('./dbSuite')
const { createSqliteDb } = require('../db/sqlite')

describeDb('sqlite', () => createSqliteDb(':memory:'))
