const sequential = require('../lib/router/sequential')
const cero = require('../index')

const errorHandler = (err, req, res) => {
  res.statusCode = 500
  res.end(err.message)
}
const { router, server } = cero({
  router: sequential(),
  errorHandler
})

router.use('/', async (req, res, next) => {
  try {
    await next()
  } catch (err) {
    errorHandler(err, req, res)
  }
})

router.get('/err1', (req, res) => {
  throw new Error('Uuuups!')
})

router.get('/err2', (req, res, next) => {
  next(new Error('Uuuups!'))
})

router.get('/err3', async (req, res, next) => {
  setTimeout(() => {
    next(new Error('Uuuups!'))
  }, 50)
})

router.get('/async-err', async (req, res, next) => {
  throw new Error('Uuuups!')
})

server.listen(3000)
