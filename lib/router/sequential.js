const { Trouter } = require('trouter')
const next = require('./../next')
const { parse } = require('regexparam')
const { LRUCache: Cache } = require('lru-cache')
const queryparams = require('../utils/queryparams')

// Default handlers as constants to avoid creating functions on each router instance
const DEFAULT_ROUTE = (req, res) => {
  res.statusCode = 404
  res.end()
}

const DEFAULT_ERROR_HANDLER = (err, req, res) => {
  res.statusCode = 500
  res.end(err.message)
}

// Simple ID generator
const generateId = () => Math.random().toString(36).substring(2, 10).toUpperCase()

module.exports = (config = {}) => {
  // Use object destructuring with defaults for cleaner config initialization
  const {
    defaultRoute = DEFAULT_ROUTE,
    errorHandler = DEFAULT_ERROR_HANDLER,
    cacheSize = -1,
    id = generateId()
  } = config

  const routers = {}

  // Initialize cache only once
  let cache = null
  if (cacheSize > 0) {
    cache = new Cache({ max: cacheSize })
  } else if (cacheSize < 0) {
    // For unlimited cache, still use LRUCache but with a very high max
    // This provides better memory management than an unbounded Map
    cache = new Cache({ max: 100000 })
  }

  const router = new Trouter()
  router.id = id

  const _use = router.use

  router.use = (prefix, ...middlewares) => {
    if (typeof prefix === 'function') {
      middlewares = [prefix, ...middlewares]
      prefix = '/'
    }
    _use.call(router, prefix, middlewares)

    if (middlewares[0]?.id) {
      // caching router -> pattern relation for urls pattern replacement
      const { pattern } = parse(prefix, true)
      routers[middlewares[0].id] = pattern
    }

    return router // Fix: return router instead of this
  }

  // Create the cleanup middleware once
  const createCleanupMiddleware = (step) => (req, res, next) => {
    req.url = req.preRouterUrl
    req.path = req.preRouterPath

    req.preRouterUrl = undefined
    req.preRouterPath = undefined

    return step()
  }

  router.lookup = (req, res, step) => {
    // Initialize URL and originalUrl if needed
    req.url = req.url || '/'
    req.originalUrl = req.originalUrl || req.url

    // Parse query parameters
    queryparams(req, req.url)

    // Fast path for cache lookup
    const reqCacheKey = cache && (req.method + req.path)
    let match = cache && cache.get(reqCacheKey)

    if (!match) {
      match = router.find(req.method, req.path)
      if (cache && reqCacheKey) {
        cache.set(reqCacheKey, match)
      }
    }

    const { handlers, params } = match

    if (handlers.length > 0) {
      // Avoid creating a new array with spread operator
      // Use the handlers array directly
      let middlewares

      if (step !== undefined) {
        // Only create a new array if we need to add the cleanup middleware
        middlewares = handlers.slice()
        middlewares.push(createCleanupMiddleware(step))
      } else {
        middlewares = handlers
      }

      // Initialize params object if needed
      if (!req.params) {
        req.params = params
      } else if (params) {
        // Faster than Object.assign for small objects
        for (const key in params) {
          req.params[key] = params[key]
        }
      }

      return next(middlewares, req, res, 0, routers, defaultRoute, errorHandler)
    } else {
      defaultRoute(req, res)
    }
  }

  router.on = (method, pattern, ...handlers) => router.add(method, pattern, handlers)

  return router
}
