function next (middlewares, req, res, index, routerPatterns = {}, defaultRoute, errorHandler) {
  const middleware = middlewares[index]
  if (!middleware) {
    if (!res.finished) {
      return defaultRoute(req, res)
    }

    return
  }

  function step (err) {
    if (err) return errorHandler(err, req, res)
    return next(middlewares, req, res, ++index, routerPatterns, defaultRoute, errorHandler)
  }

  try {
    if (middleware.id) {
    // nested routes support
      const pattern = routerPatterns[middleware.id]
      if (pattern) {
        req.preRouterUrl = req.url
        req.url = req.url.replace(pattern, '')
      }
      middleware.lookup(req, res, step)
    } else {
      return middleware(req, res, step)
    }
  } catch (err) {
    errorHandler(err, req, res)
  }
}

module.exports = next
