require('./setup')
const { describeStore } = require('./storeSuite')
const { createSqliteDb } = require('../db/sqlite')

describeStore('sqlite', () => createSqliteDb(':memory:'))
