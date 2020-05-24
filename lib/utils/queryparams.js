module.exports = (req, url) => {
  const [ pathRoute, search ] = url.split('?')
  req.path = pathRoute
  switch (search) {
    case undefined:
      req.search = null
    case '':
      req.search = '?'
      req.query = Object.create({})
      break
    default:
      req.search = '?' + search
      const qs = require('querystring')
      req.query = qs.parse(search.replace(/\[\]=/g, '='))
  }
}
