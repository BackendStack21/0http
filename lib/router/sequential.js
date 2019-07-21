const Trouter = require('trouter')
const next = require('./../next')

module.exports = (config = {}) => {
  config.defaultRoute || (config.defaultRoute = (req, res) => {
    res.statusCode = 404
    res.end()
  })

  const r = new Trouter()

  r.lookup = (req, res) => {
    req.originalUrl = req.url

    const match = r.find(req.method, req.url)
    req.params = match.params

    const middlewares = match.handlers.length
    if (middlewares > 0) {
      next(match.handlers, req, res)
    } else {
      config.defaultRoute(req, res)
    }
  }

  r.on = (method, pattern, ...handlers) => r.add(method, pattern, handlers)

  return r
}
