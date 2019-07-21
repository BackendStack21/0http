const cero = require('../index')

const { router, server } = cero({
  router: require('../lib/router/sequential')()
})

router.use('/', async (req, res, next) => {
  try {
    await next()
  } catch (err) {
    res.statusCode = 500
    res.end(err.message)
  }
})

router.get('/sayhi', () => { throw new Error('Uuuups!') }, (req, res) => {
  res.end('!')
})

server.listen(3000)
