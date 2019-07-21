const cero = require('../index')

const { router, server } = cero({
  router: require('./../lib/router/sequential')()
})

router.on('GET', '/hi', (req, res) => {
  res.end('Hello World!')
})

server.listen(3000)
