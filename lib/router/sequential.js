const { Trouter } = require('trouter')
const next = require('./../next')
const { parse } = require('regexparam')
const { LRUCache: Cache } = require('lru-cache')
const queryparams = require('./../utils/queryparams')
const dispatchError = require('./../next').dispatchError

/**
 * Default handlers as constants to avoid creating functions on each router instance.
 * This reduces memory allocation and improves performance when multiple routers are created.
 */
const DEFAULT_ROUTE = (req, res) => {
  res.statusCode = 404
  res.end()
}

const DEFAULT_ERROR_HANDLER = (err, req, res) => {
  // Safe by default: only expose error details in explicit development mode.
  // Production, staging, testing, and unset NODE_ENV all receive sanitized response.
  if (res.headersSent) {
    // Headers already flushed (mid-stream failure): a status code can no longer
    // be applied. End the response as-is, falling back to destroying the socket
    // when the stream has already finished.
    try { res.end() } catch (_) { res.destroy() }
    return
  }
  res.statusCode = 500
  res.setHeader('Content-Type', 'text/plain')
  res.end(process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error')
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
      maxSize: Math.max(cacheSize * 1024, 1 << 20), // hard byte cap (≥1MB)
      maxEntrySize: 4096, // never cache absurdly long paths
      sizeCalculation: (value, key) => key.length + 64,
      updateAgeOnGet: false, // Disable age updates for better performance
      updateAgeOnHas: false
    })
  } else if (cacheSize < 0) {
    // Reduced from 100k to 50k for better memory efficiency while maintaining performance.
    // Byte-bounded so attacker-controlled long paths cannot pin memory even when
    // they match global middleware or catch-all regex routes (empty params).
    cache = new Cache({
      max: 50000,
      maxSize: 16 * 1024 * 1024, // 16MB hard cap
      maxEntrySize: 4096,
      sizeCalculation: (value, key) => key.length + 64,
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
  // Restore the request state a nested lookup changed, using values snapshotted
  // BEFORE the lookup ran. Closure snapshots give correct stack semantics: a
  // grandchild cannot corrupt a parent's restore (preRouterUrl is a single slot,
  // so re-reading req after deeper levels run yields undefined).
  const restoreNestedUrlContext = (req, context) => {
    if (context.hasUrlContext) {
      req.url = context.url
      req.path = context.path
      delete req.preRouterUrl
      delete req.preRouterPath
    }
  }

  const restoreNestedContext = (req, context) => {
    restoreNestedUrlContext(req, context)
    req.params = context.params
  }

  const createCleanupMiddleware = (step, context) => {
    return (req, res, next) => {
      restoreNestedContext(req, context)
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
        // Parametrized matches have unbounded distinct keys (one per param
        // value): caching them pins attacker-growable memory and churns hot
        // static entries out of the LRU. Never cache them, and never cache
        // 404s either (empty handlers) — junk unmatched paths are the same
        // memory-pressure vector.
        if (match.handlers.length && Object.keys(match.params).length === 0) {
          cache.set(reqCacheKey, match)
        }
      }
    } else {
      match = router.find(req.method, req.path)
    }

    const { handlers, params } = match

    if (handlers.length) {
      // Snapshot the request state this lookup is about to change (URL rewrite +
      // params). Cleanup and error paths restore from the snapshot — closure
      // semantics, so deeper nesting levels cannot corrupt an outer restore.
      const context = {
        hasUrlContext: req.preRouterUrl !== undefined,
        url: req.preRouterUrl,
        path: req.preRouterPath,
        params: req.params
      }

      let middlewares
      if (step !== undefined) {
        // Create new array only when step middleware is needed
        middlewares = handlers.slice()
        middlewares.push(createCleanupMiddleware(step, context))
      } else {
        middlewares = handlers
      }

      // When this router is used as a nested router, the parent executor passes
      // a step function that carries the parent's error handler. Use the parent's
      // error handler so errors bubble up and are not silently handled by the
      // nested router's own default error handler.
      const activeErrorHandler = step?.errorHandler || errorHandler

      // Wrap the active error handler so request-state restoration happens
      // before the handler is invoked, and so a throwing handler can never
      // take the process down.
      const errorHandlerWithCleanup = (err, req, res) => {
        // Restore URL context only: error handlers are terminal, so keep the
        // matched route's params available to the handler.
        restoreNestedUrlContext(req, context)
        return dispatchError(activeErrorHandler, err, req, res)
      }

      // Per-level params: never mutate an upstream params object in place.
      // Nested routers inherit parent params via a shallow copy, so existing
      // consumers keep seeing merged params while mutations stay confined to
      // this level's own object (restored on cleanup/error).
      const inherited = req.params
      if (inherited === undefined && Object.keys(params).length === 0) {
        req.params = Object.create(null)
      } else {
        req.params = { ...(inherited || {}), ...(params || {}) }
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
