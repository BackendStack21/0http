const http = require('http')

module.exports = (config = {}) => {
  const router = config.router || require('./lib/router/sequential')()
  const server = config.server || http.createServer()

  server.on('request', (req, res) => {
    server instanceof http.Server
      ? setImmediate(() => router.lookup(req, res))
      : router.lookup(req, res)
  })

  return {
    router,
    server
  }
}
