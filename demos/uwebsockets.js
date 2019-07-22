
const uWS = require('uWebSockets.js')

uWS.App().get('/hi', (res, req) => {
  res.onAborted(() => {
    res.aborted = true
  })
  setTimeout(() => {
    res.end('Hello World!')
  }, 100)
}).listen(3000, () => {})
