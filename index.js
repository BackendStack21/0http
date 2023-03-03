const http = require('http')
const httpServer = http.Server
const httpsServer = require('https').Server

module.exports = (config = { prioRequestsProcessing: true }) => {
  const router = config.router || require('./lib/router/sequential')()
  const server = config.server || http.createServer()

  server.prioRequestsProcessing =
    config.prioRequestsProcessing && (server instanceof httpServer || server instanceof httpsServer)

  if (server.prioRequestsProcessing) {
    server.on('request', (req, res) => {
      setImmediate(() => router.lookup(req, res))
    })
  } else {
    server.on('request', (req, res) => {
      router.lookup(req, res)
    })
  }

  return {
    router,
    server
  }
}
