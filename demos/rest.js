const sequential = require('../lib/router/sequential')
const cero = require('../index')

const { router, server } = cero({
  router: sequential()
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
