const cero = require('./../index')
const { router, server } = cero()

router.get('/hi', (req, res) => {
  res.end('Hello World!')
})

server.listen(3000)
