// source https://github.com/jkyberneees/0http/issues/13

'use strict'

const path = require('path')
const low = require('../lib/server/low')
const cero = require('../index')

const { router, server } = cero({
  server: low()
})

router.get('/pipe.js', (req, res) => {
  res.setHeader('Content-Type', 'text/js')

  const { createReadStream } = require('fs')
  const readStream = createReadStream(path.join(__dirname, 'pipe.js'))
  readStream.pipe(res)
})

server.listen(3000, (socket) => {
  if (socket) {
    console.log('HTTP server ready!')
  }
})
