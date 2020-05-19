const uWS = require('uWebSockets.js')
const { Writable } = require('stream')
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
          if (!buffer) {
            buffer = chunk
          }
          reqWrapper.body = buffer
          if (!res.finished) {
            handler(reqWrapper, resWrapper)
          }
        } else {
          if (buffer) {
            buffer = Buffer.concat([buffer, chunk])
          } else {
            buffer = chunk
          }
        }
      })
    } else if (!res.finished) {
      handler(reqWrapper, resWrapper)
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
    const q = uRequest.getQuery()
    this.req = uRequest
    this.url = uRequest.getUrl() + (q ? '?' + q : '')
    this.method = uRequest.getMethod().toUpperCase()
    this.body = null
    this.headers = {}

    uRequest.forEach((header, value) => {
      this.headers[header] = value
    })
  }

  getRaw () {
    return this.req
  }
}

class HttpResponse extends Writable {
  constructor (uResponse, uServer) {
    super()

    this.res = uResponse
    this.server = uServer

    this.statusCode = 200
    this.statusMessage = 'OK'

    this.headers = {}
    this.headersSent = false

    this.on('pipe', _ => {
      this.__isWritable = true
      this.__writeAllHeaders()
    })
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

  __writeAllHeaders () {
    this.res.writeHeader('Date', this.server._date)

    const headerKeys = Object.keys(this.headers)
    const length = headerKeys.length
    for (let index = 0; index < length; index++) {
      const key = headerKeys[index]
      this.res.writeHeader(key, this.headers[key])
    }

    this.headersSent = true
  }

  end (data = '') {
    this.res.writeStatus(`${this.statusCode} ${this.statusMessage}`)

    if (!this.__isWritable) {
      this.__writeAllHeaders()
    }

    this.finished = true
    this.res.end(data)
  }

  getRaw () {
    return this.res
  }
}
