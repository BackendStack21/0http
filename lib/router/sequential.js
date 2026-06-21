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
  res.setHeader('Content-Type', 'text/plain')
  // Safe by default: only expose error details in explicit development mode.
  // Production, staging, testing, and unset NODE_ENV all receive sanitized response.
  if (process.env.NODE_ENV === 'development') {
    res.end(err.message)
  } else {
    res.end('Internal Server Error')
  }
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

  const _add = router.add.bind(router)

  /**
   * Wrap router.add to normalize RegExp patterns.
   * The 'g' (global) and 'y' (sticky) flags mutate lastIndex on exec/test,
   * which causes alternating match/failure across requests when caching is
   * disabled or when different paths are matched. Strip those flags while
   * preserving case-insensitive, multiline, dotAll, unicode, etc.
   */
  router.add = (method, pattern, ...handlers) => {
    if (pattern instanceof RegExp && (pattern.global || pattern.sticky)) {
      const safeFlags = pattern.flags.replace(/[gy]/g, '')
      pattern = new RegExp(pattern.source, safeFlags)
    }
    return _add(method, pattern, ...handlers)
  }

  // Trouter binds HTTP method shortcuts (get, post, ...) to the original add
  // in its constructor. Rebind them so they use our normalized add wrapper.
  const HTTP_METHODS = ['GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  HTTP_METHODS.forEach(method => {
    router[method.toLowerCase()] = router.add.bind(router, method)
  })

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
    _use.call(router, prefix, ...middlewares)

    // Optimized nested router detection - check first middleware only
    const firstMiddleware = middlewares[0]
    if (firstMiddleware?.id) {
      // Cache router -> pattern relation for URL pattern replacement in nested routing
      // This enables efficient URL rewriting when entering nested router contexts
      const { pattern, keys } = parse(prefix, true)
      routers[firstMiddleware.id] = keys.length === 0 && prefix.indexOf('*') === -1 // No params and no wildcards
        ? prefix.length // Static match
        : pattern // Regex match
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

    // Hardening: ensure req.url is a string to avoid crashes from malformed/mock requests.
    if (typeof req.url !== 'string') req.url = String(req.url)

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

      // When this router is used as a nested router, the parent executor passes
      // a step function that carries the parent's error handler. Use the parent's
      // error handler so errors bubble up and are not silently handled by the
      // nested router's own default error handler.
      const activeErrorHandler = step?.errorHandler || errorHandler

      // Wrap the active error handler so URL restoration happens before the
      // handler is invoked. This fixes state corruption when a nested router
      // handler throws, calls next(err), or rejects asynchronously.
      const errorHandlerWithCleanup = (err, req, res) => {
        if (req.preRouterUrl !== undefined) {
          req.url = req.preRouterUrl
          req.path = req.preRouterPath
          delete req.preRouterUrl
          delete req.preRouterPath
        }
        return activeErrorHandler(err, req, res)
      }

      // Optimized parameter assignment with minimal overhead
      if (!req.params) {
        // Shallow-copy: the match (and its params) may be served from the LRU
        // cache and shared across all requests to the same method+path.
        // Assigning by reference would let a middleware mutation leak between requests.
        req.params = params ? { ...params } : Object.create(null)
      } else if (params) {
        // Manual property copying - optimized for small objects
        // Pre-compute keys and length to avoid repeated calls
        Object.assign(req.params, params)
      }

      return next(middlewares, req, res, 0, routers, defaultRoute, errorHandlerWithCleanup)
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
