const { Trouter } = require('trouter')
const next = require('./../next')
const { parse } = require('regexparam')
const { LRUCache: Cache } = require('lru-cache')
const queryparams = require('./../utils/queryparams')
const { dispatchError, runDefaultRoute } = next

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

/**
 * Shared, immutable "no params" result. `find` returns it for every match that
 * carries no route parameters, so the hot path can detect the parameter-less
 * case with a single identity check instead of `Object.keys(...).length`.
 * Frozen so a shared object can never become a cross-request leak.
 */
const EMPTY_PARAMS = Object.freeze({})

// Every HTTP method trouter binds as a shortcut in its constructor.
const HTTP_METHODS = ['GET', 'HEAD', 'PATCH', 'OPTIONS', 'CONNECT', 'DELETE', 'TRACE', 'POST', 'PUT']

/**
 * Regex metacharacters that make a string route segment match a different
 * number of characters than its literal length. regexparam inserts static
 * segments into the pattern verbatim, so such routes get no length prefilter.
 * `.` is deliberately allowed: it still consumes exactly one character.
 */
const UNSAFE_SEGMENT = /[\\^$*+?()[\]{}|]/

/**
 * Derive cheap, strictly necessary length conditions for a string route,
 * mirroring regexparam's tokenizer exactly (same split, same early stop on an
 * empty segment, same param/wildcard/extension rules):
 *   - min:   every URL matching the pattern has at least this many characters
 *   - exact: for static non-loose routes, the URL length must be `exact` or
 *            `exact + 1` (optional trailing slash); -1 when not applicable
 * Any construct whose consumed length is not provable yields the permissive
 * {min: 0, exact: -1}, so a prefilter can never reject a URL the regex accepts.
 */
function routeBounds (route, loose) {
  const bounds = { min: 0, exact: -1 }
  if (typeof route !== 'string') return bounds
  let min = 0
  let dynamic = false
  let tmp
  const arr = route.split('/')
  arr[0] || arr.shift()
  while ((tmp = arr.shift())) {
    const c = tmp[0]
    if (c === '*') {
      dynamic = true
      // '/(.*)' needs the slash; '(?:/(.*))?' needs nothing.
      if (tmp[1] !== '?') min += 1
    } else if (c === ':') {
      dynamic = true
      const o = tmp.indexOf('?', 1)
      const ext = tmp.indexOf('.', 1)
      if (ext !== -1) {
        // Extension handling escapes only the leading dot; stay permissive.
        if (o !== -1 || UNSAFE_SEGMENT.test(tmp.slice(ext + 1))) return bounds
        min += 2 + (tmp.length - ext) // '/' + 1 char + '.ext'
      } else if (o === -1) {
        min += 2 // '/' + at least one character
      }
    } else {
      if (UNSAFE_SEGMENT.test(tmp)) return bounds
      min += 1 + tmp.length
    }
  }
  bounds.min = min
  if (!dynamic && !loose) bounds.exact = min
  return bounds
}

module.exports = (config = {}) => {
  // Use object destructuring with defaults for cleaner config initialization
  const {
    defaultRoute = DEFAULT_ROUTE,
    errorHandler = DEFAULT_ERROR_HANDLER,
    cacheSize = -1,
    id = generateId()
  } = config

  // Null-prototype maps: a router id such as 'constructor' must never resolve
  // to an inherited property in the executor.
  const routers = Object.create(null) // id -> prefix length | RegExp | RegExp[]
  const mounts = Object.create(null) // id -> every mount RegExp

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
  const routes = router.routes

  const _add = router.add.bind(router)

  /**
   * Attach the length prefilter bounds to the route trouter just registered.
   */
  const annotateLastRoute = (route, loose) => {
    const entry = routes[routes.length - 1]
    const { min, exact } = routeBounds(route, loose)
    entry.min = min
    entry.exact = exact
  }

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
    _add(method, pattern, ...handlers)
    annotateLastRoute(pattern, false)
    return router
  }

  // Trouter binds HTTP method shortcuts (get, post, ...) and `all` to the
  // original add in its constructor. Rebind every one of them so they all go
  // through the normalized add wrapper (same flag handling, same prefilters).
  router.all = router.add.bind(router, '')
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
    // Same g/y flag normalization as add(): a sticky/global prefix RegExp
    // would alternate between matching and failing across requests.
    if (prefix instanceof RegExp && (prefix.global || prefix.sticky)) {
      prefix = new RegExp(prefix.source, prefix.flags.replace(/[gy]/g, ''))
    }
    _use.call(router, prefix, ...middlewares)
    annotateLastRoute(prefix, true)

    // Optimized nested router detection - check first middleware only
    const firstMiddleware = middlewares[0]
    if (firstMiddleware?.id) {
      // Cache router -> pattern relation for URL pattern replacement in nested routing
      // This enables efficient URL rewriting when entering nested router contexts
      const { pattern, keys } = parse(prefix, true)
      const single = typeof prefix === 'string' && keys.length === 0 && prefix.indexOf('*') === -1 // No params and no wildcards
        ? prefix.length // Static match
        : pattern // Regex match
      const list = mounts[firstMiddleware.id] ??= []
      list.push(pattern)
      // Mounted once: cheapest form. Mounted at several prefixes: the
      // executor picks the first mount RegExp that matches the path.
      routers[firstMiddleware.id] = list.length === 1 ? single : list
    }

    return router // Ensure chainable API by returning router instance
  }

  /**
   * Route matcher. Same semantics and result shape as Trouter#find (regexes
   * from regexparam decide every match; HEAD falls back to GET handlers;
   * handlers accumulate in registration order), with three hot-path changes:
   *   - routes whose length bounds the URL cannot satisfy skip the regex entirely
   *   - the params object is only allocated once a parameter is captured;
   *     parameter-less matches share the frozen EMPTY_PARAMS
   *   - multi-handler routes are appended in place instead of via concat
   */
  const find = (method, url) => {
    const isHEAD = method === 'HEAD'
    const ulen = url.length
    const handlers = []
    let params = EMPTY_PARAMS

    for (let i = 0; i < routes.length; i++) {
      const tmp = routes[i]
      const m = tmp.method
      if (m !== method && m !== '' && !(isHEAD && m === 'GET')) continue
      // Prefilters: `undefined` bounds (route pushed behind our back) compare
      // false here, so they fall through to the regex, never to a rejection.
      if (ulen < tmp.min) continue

      const keys = tmp.keys
      if (keys === false) {
        // User-supplied RegExp: named groups become params.
        const matches = tmp.pattern.exec(url)
        if (matches === null) continue
        const groups = matches.groups
        if (groups !== undefined) {
          if (params === EMPTY_PARAMS) params = {}
          for (const k in groups) params[k] = groups[k]
        }
      } else if (keys.length > 0) {
        const matches = tmp.pattern.exec(url)
        if (matches === null) continue
        if (params === EMPTY_PARAMS) params = {}
        for (let j = 0; j < keys.length; j++) params[keys[j]] = matches[j + 1]
      } else {
        const exact = tmp.exact
        if (exact >= 0 && ulen !== exact && ulen !== exact + 1) continue
        if (!tmp.pattern.test(url)) continue
      }

      const hs = tmp.handlers
      if (hs.length > 1) {
        for (let j = 0; j < hs.length; j++) handlers.push(hs[j])
      } else {
        handlers.push(hs[0])
      }
    }

    return { params, handlers }
  }
  router.find = find

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
    if (cache !== null) {
      // Pre-compute cache key with direct concatenation (fastest approach)
      const reqCacheKey = req.method + req.path
      match = cache.get(reqCacheKey)

      if (match === undefined) {
        match = router.find(req.method, req.path)
        // Parametrized matches have unbounded distinct keys (one per param
        // value): caching them pins attacker-growable memory and churns hot
        // static entries out of the LRU. Never cache them, and never cache
        // 404s either (empty handlers) — junk unmatched paths are the same
        // memory-pressure vector.
        if (match.handlers.length !== 0 && match.params === EMPTY_PARAMS) {
          cache.set(reqCacheKey, match)
        }
      }
    } else {
      match = router.find(req.method, req.path)
    }

    const { handlers, params } = match

    if (handlers.length === 0) {
      // A throwing or rejecting 404 handler is contained like any middleware.
      return runDefaultRoute(defaultRoute, req, res, step?.errorHandler || errorHandler)
    }

    // Per-level params: never mutate an upstream params object in place.
    // Nested routers inherit parent params via a shallow copy, so existing
    // consumers keep seeing merged params while mutations stay confined to
    // this level's own object (restored on cleanup/error).
    const inherited = req.params
    if (inherited === undefined) {
      req.params = params === EMPTY_PARAMS ? Object.create(null) : { ...params }
    } else {
      req.params = { ...inherited, ...params }
    }

    // Fast path: a top-level lookup (no parent executor, no nested URL rewrite
    // in effect) has nothing to restore. Skip the snapshot and the wrapping
    // error handler; `next` already contains every error-handler invocation.
    if (step === undefined && req.preRouterUrl === undefined) {
      return next(handlers, req, res, 0, routers, defaultRoute, errorHandler)
    }

    // Snapshot the request state this lookup is about to change (URL rewrite +
    // params). Cleanup and error paths restore from the snapshot — closure
    // semantics, so deeper nesting levels cannot corrupt an outer restore.
    const context = {
      hasUrlContext: req.preRouterUrl !== undefined,
      url: req.preRouterUrl,
      path: req.preRouterPath,
      params: inherited
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

    return next(middlewares, req, res, 0, routers, defaultRoute, errorHandlerWithCleanup)
  }

  /**
   * Shorthand method for registering routes with specific HTTP methods.
   * Delegates to router.add with the provided method, pattern, and handlers.
   */
  router.on = (method, pattern, ...handlers) => router.add(method, pattern, handlers)

  return router
}
