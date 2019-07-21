const cero = require('../index')

const { router, server } = cero({
  router: require('find-my-way')()
})

router.on('GET', '/hi', (req, res) => {
  res.end('Hello World!')
})

server.listen(3000)
