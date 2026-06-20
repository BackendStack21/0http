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

function next (middlewares, req, res, index, routers, defaultRoute, errorHandler) {
  // Fast path for end of middleware chain
  if (index >= middlewares.length) {
    // Only call defaultRoute if response is not finished
    return !res.finished && defaultRoute(req, res)
  }

  // Get current middleware
  const middleware = middlewares[index]

  // Create step function - this is called by middleware to continue the chain
  const step = function (err) {
    return err
      ? errorHandler(err, req, res)
      : next(middlewares, req, res, index + 1, routers, defaultRoute, errorHandler)
  }
  // Expose the error handler so nested routers can bubble errors to the parent
  // instead of being handled by their own default error handler.
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

        // Replace pattern in URL - this is a hot path, optimize it
        if (typeof pattern === 'number') {
          req.url = req.url.slice(pattern)
        } else {
          req.url = req.url.replace(pattern, '')
        }

        // Ensure URL starts with a slash - use charCodeAt for performance
        if (req.url.length === 0 || req.url.charCodeAt(0) !== 47) { // 47 is '/'
          req.url = '/' + req.url
        }
      }

      try {
        // Call router's lookup method
        const result = middleware.lookup(req, res, step)
        return result && typeof result.then === 'function'
          ? result.catch(err => {
            restoreNestedUrl(req)
            return errorHandler(err, req, res)
          })
          : result
      } catch (err) {
        // Sync error that escaped the nested router's own handling.
        // Restore the parent URL context before invoking the error handler.
        restoreNestedUrl(req)
        return errorHandler(err, req, res)
      }
    }

    // Regular middleware function
    const result = middleware(req, res, step)
    return result && typeof result.then === 'function'
      ? result.catch(err => errorHandler(err, req, res))
      : result
  } catch (err) {
    return errorHandler(err, req, res)
  }
}

module.exports = next
