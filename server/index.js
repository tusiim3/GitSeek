const config = require('./config')
const { app, logger } = require('./app')

app.listen(config.port, () => {
  logger.info({ port: config.port, url: config.appUrl }, 'Server started')
})
