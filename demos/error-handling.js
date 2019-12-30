const sequential = require('../lib/router/sequential')
const cero = require('../index')

const { router, server } = cero({
  router: sequential()
})

router.use('/', async (req, res, next) => {
  try {
    await next()
  } catch (err) {
    res.statusCode = 500
    res.end(err.message)
  }
})

router.get('/err1', (req, res) => {
  throw new Error('Uuuups!')
})

router.get('/err2', (req, res, next) => {
  next(new Error('Uuuups!'))
})

server.listen(3000)
