const low = require('../lib/server/low')
const cero = require('../index')

const { router, server } = cero({
  server: low()
})

router.on('GET', '/hi', (req, res) => {
  res.end('Hello World!')
})

server.listen(3000, (socket) => {
  if (socket) {
    console.log('HTTP server ready!')
  }
})
