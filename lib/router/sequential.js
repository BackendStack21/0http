const { Trouter } = require('trouter')
const next = require('./../next')
const { parse } = require('regexparam')
const { LRUCache: Cache } = require('lru-cache')
const queryparams = require('./../utils/queryparams')

/**
 * Default handlers as constants to avoid creating functions on each router instance.
 * This reduces memory allocation and improves performance when multiple routers are created.
 */
const DEFAULT_ROUTE = (req, res) => {
  res.statusCode = 404
  res.end()
}

const DEFAULT_ERROR_HANDLER = (err, req, res) => {
  res.statusCode = 500
  // Note: err.message could expose sensitive information in production
  res.end(err.message)
}

/**
 * Simple ID generator using Math.random for router identification.
 * Warning: Not cryptographically secure - suitable only for internal routing logic.
 * Optimized to minimize string operations.
 */
const generateId = () => {
  // Use a more efficient approach - avoid substring operations
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

module.exports = (config = {}) => {
  // Use object destructuring with defaults for cleaner config initialization
  const {
    defaultRoute = DEFAULT_ROUTE,
    errorHandler = DEFAULT_ERROR_HANDLER,
    cacheSize = -1,
    id = generateId()
  } = config

  const routers = {}

  /**
   * Pre-create frozen empty objects for better performance and safety.
   * Use Object.create(null) for prototype pollution protection.
   * Frozen objects prevent accidental mutation that could cause cross-request state pollution.
   * These are reused across requests when no query params or route params are present.
   */
  const EMPTY_PARAMS = Object.freeze(Object.create(null))

  /**
   * Initialize LRU cache for route matching results with optimized settings.
   * Cache keys are method+path combinations to speed up repeated lookups.
   * - cacheSize > 0: Limited LRU cache with specified max entries
   * - cacheSize = 0: No caching (disabled)
   * - cacheSize < 0: Large LRU cache (50k entries) for "unlimited" mode
   * Optimized cache size for better memory management and performance.
   */
  let cache = null
  if (cacheSize > 0) {
    cache = new Cache({
      max: cacheSize,
      updateAgeOnGet: false, // Disable age updates for better performance
      updateAgeOnHas: false
    })
  } else if (cacheSize < 0) {
    // Reduced from 100k to 50k for better memory efficiency while maintaining performance
    cache = new Cache({
      max: 50000,
      updateAgeOnGet: false,
      updateAgeOnHas: false
    })
  }

  const router = new Trouter()
  router.id = id

  const _use = router.use

  /**
   * Enhanced router.use method with support for nested routers.
   * Handles both middleware functions and nested router instances.
   * Automatically handles prefix parsing when first argument is a function.
   * Optimized for minimal overhead in the common case.
   */
  router.use = (prefix, ...middlewares) => {
    if (typeof prefix === 'function') {
      middlewares = [prefix, ...middlewares]
      prefix = '/'
    }
    _use.call(router, prefix, middlewares)

    // Optimized nested router detection - check first middleware only
    const firstMiddleware = middlewares[0]
    if (firstMiddleware?.id) {
      // Cache router -> pattern relation for URL pattern replacement in nested routing
      // This enables efficient URL rewriting when entering nested router contexts
      const { pattern } = parse(prefix, true)
      routers[firstMiddleware.id] = pattern
    }

    return router // Ensure chainable API by returning router instance
  }

  /**
   * Creates cleanup middleware for nested router restoration.
   * This middleware restores the original URL and path after nested router processing.
   * Uses property deletion instead of undefined assignment for better performance.
   * Optimized to minimize closure creation overhead.
   */
  const createCleanupMiddleware = (step) => {
    // Pre-create the cleanup function to avoid repeated function creation
    return (req, res, next) => {
      req.url = req.preRouterUrl
      req.path = req.preRouterPath

      // Use delete for better performance than setting undefined
      delete req.preRouterUrl
      delete req.preRouterPath

      return step()
    }
  }

  router.lookup = (req, res, step) => {
    // Initialize URL and originalUrl if needed - use nullish coalescing for better performance
    req.url ??= '/'
    req.originalUrl ??= req.url

    // Parse query parameters using optimized utility
    queryparams(req, req.url)

    // Cache lookup optimization - minimize variable assignments
    let match
    if (cache) {
      // Pre-compute cache key with direct concatenation (fastest approach)
      const reqCacheKey = req.method + req.path
      match = cache.get(reqCacheKey)

      if (!match) {
        match = router.find(req.method, req.path)
        cache.set(reqCacheKey, match)
      }
    } else {
      match = router.find(req.method, req.path)
    }

    const { handlers, params } = match

    if (handlers.length) {
      // Optimized middleware array handling
      let middlewares
      if (step !== undefined) {
        // Create new array only when step middleware is needed
        middlewares = handlers.slice()
        middlewares.push(createCleanupMiddleware(step))
      } else {
        middlewares = handlers
      }

      // Optimized parameter assignment with minimal overhead
      if (!req.params) {
        // Use pre-created empty object or provided params directly
        req.params = params || EMPTY_PARAMS
      } else if (params) {
        // Manual property copying - optimized for small objects
        // Pre-compute keys and length to avoid repeated calls
        const paramKeys = Object.keys(params)
        let i = paramKeys.length
        while (i--) {
          const key = paramKeys[i]
          req.params[key] = params[key]
        }
      }

      return next(middlewares, req, res, 0, routers, defaultRoute, errorHandler)
    } else {
      defaultRoute(req, res)
    }
  }

  /**
   * Shorthand method for registering routes with specific HTTP methods.
   * Delegates to router.add with the provided method, pattern, and handlers.
   */
  router.on = (method, pattern, ...handlers) => router.add(method, pattern, handlers)

  return router
}
