const uWS = require('uWebSockets.js')
const REQUEST_EVENT = 'request'

module.exports = (config = {}) => {
  let handler = (req, res) => {
    res.statusCode = 404
    res.statusMessage = 'Not Found'

    res.end()
  }

  const uServer = uWS.App(config).any('/*', (res, req) => {
    res.finished = false
    res.onAborted(() => {
      res.finished = true
    })

    const reqWrapper = new HttpRequest(req)
    const resWrapper = new HttpResponse(res, uServer)

    const method = reqWrapper.method
    if (method !== 'GET' && method !== 'HEAD') {
      let buffer

      res.onData((bytes, isLast) => {
        const chunk = Buffer.from(bytes)
        if (isLast) {
          buffer || (buffer = chunk)

          reqWrapper.body = buffer
          res.finished || handler(reqWrapper, resWrapper)
        } else {
          if (buffer) {
            buffer = Buffer.concat([buffer, chunk])
          } else {
            buffer = chunk
          }
        }
      })
    } else {
      res.finished || handler(reqWrapper, resWrapper)
    }
  })

  uServer._date = new Date().toUTCString()
  const timer = setInterval(() => (uServer._date = new Date().toUTCString()), 1000)

  const facade = {
    on (event, cb) {
      if (event !== REQUEST_EVENT) throw new Error(`Given "${event}" event is not supported!`)

      handler = cb
    },

    close () {
      clearInterval(timer)
      uWS.us_listen_socket_close(uServer._socket)
    }
  }
  facade.listen = facade.start = (port, cb) => {
    uServer.listen(port, socket => {
      uServer._socket = socket

      cb(socket)
    })
  }

  return facade
}

class HttpRequest {
  constructor (uRequest) {
    this.req = uRequest
    this.url = uRequest.getUrl() + (uRequest.getQuery() ? '?' + uRequest.getQuery() : '')
    this.method = uRequest.getMethod().toUpperCase()
    this.body = null
    this.headers = {}

    uRequest.forEach((k, v) => {
      this.headers[k] = v
    })
  }

  getRaw () {
    return this.req
  }
}

class HttpResponse {
  constructor (uResponse, uServer) {
    this.res = uResponse
    this.server = uServer

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

  getHeader (name) {
    return this.headers[name]
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
