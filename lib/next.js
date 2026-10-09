/**
 * Optimized middleware executor
 *
 * @param {Array} middlewares - Array of middleware functions
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Number} index - Current middleware index
 * @param {Object} routers - Router patterns map
 * @param {Function} defaultRoute - Default route handler
 * @param {Function} errorHandler - Error handler
 * @returns {*} Result of middleware execution
 */

/**
 * Restore the original URL and path after leaving a nested router context.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
function restoreNestedUrl (req) {
  if (req.preRouterUrl !== undefined) {
    req.url = req.preRouterUrl
    req.path = req.preRouterPath
    delete req.preRouterUrl
    delete req.preRouterPath
  }
}

/**
 * Contain every error-handler invocation so a routing error can never take the
 * process down. A handler error after headers are sent makes res.setHeader
 * throw ERR_HTTP_HEADERS_SENT; a user-supplied errorHandler may throw (sync)
 * or reject (async) for any reason. All of these previously escaped as
 * uncaughtException / unhandledRejection and killed the server.
 */
function failSafe (res) {
  if (res.headersSent) {
    // Response already started: a fresh status is impossible. End it as-is,
    // falling back to destroying the socket when the stream already finished.
    try { res.end() } catch (_) { res.destroy() }
    return undefined
  }
  // Last-resort bare 500 for a broken error handler.
  res.statusCode = 500
  try { res.setHeader('Content-Type', 'text/plain') } catch (_) {}
  try { res.end('Internal Server Error') } catch (_) {}
  return undefined
}

function dispatchError (errorHandler, err, req, res) {
  // Nothing can be written once the response has ended: a handler that tries
  // (res.end(body), res.write) makes Node emit 'error' on the next tick, which
  // no try/catch here can reach. Skip the handler and finish safely instead.
  if (res.writableEnded === true) return failSafe(res)
  let result
  try {
    result = errorHandler(err, req, res)
  } catch (_) {
    return failSafe(res)
  }
  // An async error handler can reject after returning: contain that too.
  // Promise.resolve() normalises arbitrary thenables (which may lack .catch).
  return result && typeof result.then === 'function'
    ? Promise.resolve(result).catch(() => failSafe(res))
    : result
}

/**
 * Run the 404 handler under the same containment as any middleware: a sync
 * throw or a rejected promise from `defaultRoute` goes to the error handler
 * instead of escaping the request as uncaughtException / unhandledRejection.
 */
function runDefaultRoute (defaultRoute, req, res, errorHandler) {
  try {
    const result = defaultRoute(req, res)
    return result && typeof result.then === 'function'
      ? result.catch(err => dispatchError(errorHandler, err, req, res))
      : result
  } catch (err) {
    return dispatchError(errorHandler, err, req, res)
  }
}

/**
 * Strip a mount prefix from the PATH portion of req.url, keeping the query
 * string intact. Matching the prefix against the full URL let a query such as
 * `?x=/admin` be consumed by a `:param` segment and the remainder become the
 * nested router's path. `pattern` is a static prefix length, a RegExp, or an
 * array of RegExps when the same router is mounted at several prefixes.
 */
function stripPrefix (url, pattern) {
  const q = url.indexOf('?')
  const path = q === -1 ? url : url.slice(0, q)
  const rest = q === -1 ? '' : url.slice(q)
  let stripped
  if (typeof pattern === 'number') {
    stripped = path.slice(pattern)
  } else {
    if (Array.isArray(pattern)) {
      let hit = null
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i].test(path)) { hit = pattern[i]; break }
      }
      if (hit === null) return url
      pattern = hit
    }
    stripped = path.replace(pattern, '')
  }
  // Ensure the nested path starts with a slash - 47 is '/'
  if (stripped.length === 0 || stripped.charCodeAt(0) !== 47) stripped = '/' + stripped
  return stripped + rest
}

function next (middlewares, req, res, index, routers, defaultRoute, errorHandler) {
  // Fast path for end of middleware chain
  if (index >= middlewares.length) {
    // Only call defaultRoute if response is not finished
    return !res.finished && runDefaultRoute(defaultRoute, req, res, errorHandler)
  }

  // Get current middleware
  const middleware = middlewares[index]

  // Create step function - this is called by middleware to continue the chain
  const step = function (err) {
    return err
      ? dispatchError(errorHandler, err, req, res)
      : next(middlewares, req, res, index + 1, routers, defaultRoute, errorHandler)
  }
  // Expose the error handler so nested routers can bubble errors to the parent
  // instead of being handled by their own default error handler. Set it for
  // every step: a middleware may hand `step` to `child.lookup(req, res, step)`
  // directly, and that public flow must bubble errors too.
  step.errorHandler = errorHandler

  try {
    // Check if middleware is a router (has id)
    if (middleware.id) {
      // Get pattern for nested router
      const pattern = routers?.[middleware.id]

      if (pattern) {
        // Save original URL and path
        req.preRouterUrl = req.url
        req.preRouterPath = req.path

        // Hand the nested router the URL with the mount prefix removed
        req.url = stripPrefix(req.url, pattern)
      }

      try {
        // Call router's lookup method
        const result = middleware.lookup(req, res, step)
        return result && typeof result.then === 'function'
          ? result.catch(err => {
            restoreNestedUrl(req)
            return dispatchError(errorHandler, err, req, res)
          })
          : result
      } catch (err) {
        // Sync error that escaped the nested router's own handling.
        // Restore the parent URL context before invoking the error handler.
        restoreNestedUrl(req)
        return dispatchError(errorHandler, err, req, res)
      }
    }

    // Regular middleware function
    const result = middleware(req, res, step)
    return result && typeof result.then === 'function'
      ? result.catch(err => dispatchError(errorHandler, err, req, res))
      : result
  } catch (err) {
    return dispatchError(errorHandler, err, req, res)
  }
}

module.exports = next
module.exports.dispatchError = dispatchError
module.exports.runDefaultRoute = runDefaultRoute
