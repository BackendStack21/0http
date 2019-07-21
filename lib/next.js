function next (middlewares, req, res, middlewareIndex = 0) {
  const middleware = middlewares[middlewareIndex]
  if (!middleware) {
    if (!res.finished) {
      return res.end()
    }

    return
  }

  function step (err) {
    if (err) return err
    return next(middlewares, req, res, ++middlewareIndex)
  }

  return middleware(req, res, step)
}

module.exports = next
