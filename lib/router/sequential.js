const Trouter = require('trouter')
const next = require('./../next')
const LRU = require('lru-cache')

module.exports = (config = {}) => {
  config.defaultRoute || (config.defaultRoute = (req, res) => {
    res.statusCode = 404
    res.end()
  })
  config.errorHandler = config.errorHandler || ((err, req, res) => {
    res.statusCode = 500
    res.end(err.message)
  })
  config.cacheSize = config.cacheSize || 1000
  config.id = config.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5)).toUpperCase()

  let routersPattern = null
  const cache = new LRU(config.cacheSize)
  const router = new Trouter()
  router.id = config.id

  router._use = router.use

  router.use = (prefix, ...middlewares) => {
    if (typeof prefix === 'function') {
      middlewares = prefix
      prefix = '/'
    }
    router._use(prefix, middlewares)

    return this
  }

  router.lookup = (req, res, step) => {
    req.url = req.url || '/'
    req.originalUrl = req.originalUrl || req.url
    req.path = req.url.split('?')[0]

    const reqCacheKey = `${req.method + req.path}`
    let match = cache.get(reqCacheKey)
    if (!match) {
      match = router.find(req.method, req.path)
      cache.set(reqCacheKey, match)
    }

    if (match.handlers.length) {
      if (routersPattern === null) {
        routersPattern = {}
        // caching router -> pattern relation for urls pattern replacement
        router.routes.forEach(route => route.handlers.forEach(h => {
          if (h.id) {
            routersPattern[h.id] = route.pattern
          }
        }))
      }

      const middlewares = [...match.handlers]
      if (step) {
        // router is being used as a nested router
        middlewares.push((req, res, next) => {
          req.url = req.preRouterUrl
          req.path = req.preRouterPath

          delete req.preRouterUrl
          delete req.preRouterPath

          return step()
        })
      }

      // middlewares invocation
      req.params = Object.assign(req.params || {}, match.params)

      return next(middlewares, req, res, 0, routersPattern, config.defaultRoute, config.errorHandler)
    } else {
      config.defaultRoute(req, res)
    }
  }

  router.on = (method, pattern, ...handlers) => router.add(method, pattern, handlers)

  return router
}
