const cero = require('../index')
const { router, server } = cero({
  router: require('../lib/router/sequential')({
    cacheSize: 0
  })
})

router.get('/hi', (req, res) => {
  res.end('Hello!')
})

server.listen(3000)
