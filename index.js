const http = require('http')
const httpServer = http.Server
const httpsServer = require('https').Server

module.exports = (config = {}) => {
  const router = config.router || require('./lib/router/sequential')(config)
  const server = config.server || http.createServer()

  // Default to true even when a partial config is provided. Keeping the default
  // in the parameter alone would silently flip it off for any `zero({ ... })` call.
  const prioRequestsProcessing = config.prioRequestsProcessing ?? true
  server.prioRequestsProcessing =
    prioRequestsProcessing && (server instanceof httpServer || server instanceof httpsServer)

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
