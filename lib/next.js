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
function next (middlewares, req, res, index, routers, defaultRoute, errorHandler) {
  // Fast path for end of middleware chain
  if (index >= middlewares.length) {
    // Only call defaultRoute if response is not finished
    return !res.finished && defaultRoute(req, res)
  }

  // Get current middleware and increment index
  const middleware = middlewares[index++]

  // Create step function - this is called by middleware to continue the chain
  const step = function (err) {
    return err
      ? errorHandler(err, req, res)
      : next(middlewares, req, res, index, routers, defaultRoute, errorHandler)
  }

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
        req.url = req.url.replace(pattern, '')

        // Ensure URL starts with a slash
        if (req.url.length === 0 || req.url.charCodeAt(0) !== 47) { // 47 is '/'
          req.url = '/' + req.url
        }
      }

      // Call router's lookup method
      return middleware.lookup(req, res, step)
    }

    // Regular middleware function
    return middleware(req, res, step)
  } catch (err) {
    return errorHandler(err, req, res)
  }
}

module.exports = next
