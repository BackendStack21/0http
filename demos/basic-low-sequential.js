const low = require('./../lib/server/low')
const sequential = require('../lib/router/sequential')
const cero = require('../index')

const { router, server } = cero({
  server: low(),
  router: sequential()
})

router.on('GET', '/hi', (req, res) => {
  res.end('Hello World!')
})

server.listen(3000, running => {})
