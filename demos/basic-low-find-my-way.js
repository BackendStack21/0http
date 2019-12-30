const low = require('./../lib/server/low')
const cero = require('../index')

const { router, server } = cero({
  server: low(),
  router: require('find-my-way')()
})

router.on('GET', '/hi', (req, res) => {
  res.end('Hello World!')
})

server.start(3000, () => {})
