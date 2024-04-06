function next (middlewares, req, res, index, routers, defaultRoute, errorHandler) {
  routers = routers || {}

  if (index >= middlewares.length) {
    if (!res.finished) {
      return defaultRoute(req, res)
    }

    return
  }

  const middleware = middlewares[index++]

  function step (err) {
    if (err) {
      return errorHandler(err, req, res)
    } else {
      return next(middlewares, req, res, index, routers, defaultRoute, errorHandler)
    }
  }

  try {
    if (middleware.id) {
      // nested routes support
      const pattern = routers[middleware.id]
      if (pattern) {
        req.preRouterUrl = req.url
        req.preRouterPath = req.path

        req.url = req.url.replace(pattern, '')
        if (req.url.charCodeAt(0) !== 47) {
          req.url = '\u002f'.concat(req.url)
        }
      }

      return middleware.lookup(req, res, step)
    } else {
      return middleware(req, res, step)
    }
  } catch (err) {
    return errorHandler(err, req, res)
  }
}

module.exports = next
