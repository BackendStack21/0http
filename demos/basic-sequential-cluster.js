const cluster = require('cluster')
const cpus = require('os').cpus()
const cero = require('../index')

const { router, server } = cero({
  router: require('./../lib/router/sequential')()
})

router.get('/hi', (req, res) => {
  res.end('Hello World!')
})

if (cluster.isMaster) {
  cpus.forEach(() => cluster.fork())
} else {
  server.listen(3000)
}
