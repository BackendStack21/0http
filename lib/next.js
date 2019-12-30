function next (middlewares, req, res, index, routerPatterns = {}, defaultRoute) {
  const middleware = middlewares[index]
  if (!middleware) {
    if (!res.finished) {
      return defaultRoute(req, res)
    }

    return
  }

  function step (err) {
    if (err) throw err
    return next(middlewares, req, res, ++index, routerPatterns, defaultRoute)
  }

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
}

module.exports = next
