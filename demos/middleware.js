const cero = require('./../index')

const { router, server } = cero({
  router: require('./../lib/router/sequential')()
})

router.use('/', (req, res, next) => {
  res.write('Hello ')
  return next()
})
router.use('/', (req, res, next) => {
  res.write('World')
  return next()
})
router.get('/hi', (req, res, next) => {
  res.write('!')
  return next()
}, (req, res) => {
  res.end()
})

server.listen(3000)
