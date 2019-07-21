const cero = require('../index')
const { router, server } = cero({
  router: require('./../lib/router/sequential')()
})

router.get('/', (req, res) => {
  res.end()
})

router.get('/user/:id', (req, res) => {
  res.end(req.params.id)
})

router.post('/user', (req, res) => {
  res.end()
})

server.listen(3000)
