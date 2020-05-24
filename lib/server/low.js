const uWS = require('uWebSockets.js')
const { Writable } = require('stream')
const { toString, toLowerCase } = require('../utils/string')
const { forEach } = require('../utils/object')
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
    this.statusCode = null
    this.statusMessage = null
    this.body = null
    this.headers = {}

    uRequest.forEach((header, value) => {
      this.headers[header] = value
    })
  }

  getRawHeaders () {
    const raw = []
    forEach(this.headers, (header, value) => {
      raw.push(header, value)
    })
    return raw
  }

  getRaw () {
    return this.req
  }
}

function writeAllHeaders () {
  this.res.writeHeader('Date', this.server._date)

  forEach(this.__headers, ([name, value]) => {
    this.res.writeHeader(name, value)
  })

  this.headersSent = true
}

class HttpResponse extends Writable {
  constructor (uResponse, uServer) {
    super()

    this.res = uResponse
    this.server = uServer

    this.statusCode = 200
    this.statusMessage = 'OK'

    this.__headers = {}
    this.headersSent = false

    this.on('pipe', _ => {
      this.__isWritable = true
      writeAllHeaders.call(this)
    })
  }

  setHeader (name, value) {
    this.__headers[toLowerCase(name)] = [name, toString(value)]
  }

  getHeaderNames () {
    return Object.keys(this.__headers)
  }

  getHeaders () {
    const headers = {}
    forEach(this.__headers, ([, value], name) => {
      headers[name] = value
    })
    return headers
  }

  getHeader (name) {
    return this.__headers[toLowerCase(name)]
  }

  removeHeader (name) {
    delete this.__headers[toLowerCase(name)]
  }

  write (data) {
    this.res.write(data)
  }

  writeHead (statusCode) {
    this.statusCode = statusCode
    let headers
    if (arguments.length === 2) {
      headers = arguments[1]
    } else if (arguments.length === 3) {
      this.statusMessage = arguments[1]
      headers = arguments[2]
    } else {
      headers = {}
    }
    forEach(headers, (value, name) => {
      this.setHeader(name, value)
    })
  }

  end (data = '') {
    this.res.writeStatus(`${this.statusCode} ${this.statusMessage}`)

    if (!this.__isWritable) {
      writeAllHeaders.call(this)
    }

    this.finished = true
    this.res.end(data)
  }

  getRaw () {
    return this.res
  }
}
