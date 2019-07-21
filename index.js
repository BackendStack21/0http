const http = require('http')

module.exports = (config = {}) => {
  const router = config.router || require('find-my-way')()
  const server = config.server || http.createServer()

  server.on('request', (req, res) => setImmediate(() => router.lookup(req, res)))

  return {
    router,
    server
  }
}
