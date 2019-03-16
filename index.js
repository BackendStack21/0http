const http = require('http')
const findMyWay = require('find-my-way')

module.exports = (config = {}) => {
  const router = config.router || findMyWay()
  const server = config.server || http.createServer()

  server.on('request', (req, res) => {
    setImmediate(() => router.lookup(req, res))
  })

  return {
    router,
    server
  }
}
