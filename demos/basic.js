const cero = require('./../index')
const { router, server } = cero()
router.use((req, res, next) => {
  req.ctx = {
    server: 'node'
  }

  return next()
})
router.get('/hi', (req, res) => {
  res.end(`Hello World from '${req.ctx.server}' engine!`)
})

server.listen(3000)
