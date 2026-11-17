const config = require('./config')
const { app, db, logger } = require('./app')

async function start() {
  await db.init()
  app.listen(config.port, () => {
    logger.info({ port: config.port, url: config.appUrl, database: db.kind }, 'Server started')
  })
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start')
  process.exit(1)
})
