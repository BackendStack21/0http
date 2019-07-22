const uWS = require('uWebSockets.js')
const REQUEST_EVENT = 'request'

module.exports = (config = {}) => {
  const handlers = {
    request: (req, res) => {
      res.statusCode = 404
      res.statusMessage = 'Not Found'

      res.end()
    }
  }

  const server = uWS.App(config).any('/*', (res, req) => {
    res.finished = false
    res.onAborted(() => {
      res.finished = true
    })

    const reqWrapper = new HttpRequest(req)
    const resWrapper = new HttpResponse(res, server)

    const method = reqWrapper.method
    if (method !== 'GET' && method !== 'HEAD') {
      let buffer

      res.onData((bytes, isLast) => {
        const chunk = Buffer.from(bytes)
        if (isLast) {
          buffer || (buffer = chunk)

          reqWrapper.body = buffer
          res.finished || handlers[REQUEST_EVENT](reqWrapper, resWrapper)
        } else {
          if (buffer) {
            buffer = Buffer.concat([buffer, chunk])
          } else {
            buffer = chunk
          }
        }
      })
    } else {
      res.finished || handlers[REQUEST_EVENT](reqWrapper, resWrapper)
    }
  })

  server.on = (event, cb) => {
    handlers[event] = cb
  }

  server.start = (port, cb) => {
    server.listen(port, socket => {
      server._socket = socket

      cb(socket)
    })
  }

  server._date = new Date().toUTCString()
  const timer = setInterval(() => (server._date = new Date().toUTCString()), 1000)
  server.close = () => {
    clearInterval(timer)
    uWS.us_listen_socket_close(server._socket)
  }

  return server
}

class HttpRequest {
  constructor (req) {
    this.req = req

    this.url = req.getUrl()
    this.originalUrl = this.url

    this.method = req.getMethod().toUpperCase()

    this.body = null

    this.headers = {}
    req.forEach((k, v) => {
      this.headers[k] = v
    })

    this.query = req.getQuery()
  }

  getRaw () {
    return this.req
  }
}

class HttpResponse {
  constructor (res, server) {
    this.res = res
    this.server = server

    this.statusCode = 200
    this.statusMessage = 'OK'

    this.headers = {}
    this.headersSent = false
  }

  setHeader (name, value) {
    this.headers[name] = String(value)
  }

  getHeaderNames () {
    return Object.keys(this.headers)
  }

  getHeaders () {
    return Object.freeze(this.headers)
  }

  removeHeader (name) {
    delete this.headers[name]
  }

  write (data) {
    this.res.write(data)
  }

  end (data = '') {
    this.res.writeStatus(`${this.statusCode} ${this.statusMessage}`)
    this.res.writeHeader('Date', this.server._date)

    Object.keys(this.headers).forEach(name => {
      this.res.writeHeader(name, this.headers[name])
    })
    this.headersSent = true
    this.finished = true

    this.res.end(data)
  }

  getRaw () {
    return this.res
  }
}
