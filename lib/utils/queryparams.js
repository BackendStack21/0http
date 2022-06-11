module.exports = (req, url) => {
  const [path, search = ''] = url.split('?')
  const searchParams = new URLSearchParams(search.replaceAll('[]=', '='))
  const query = {}
  for (const [name, value] of searchParams.entries()) {
    if (query[name]) {
      query[name] = [].concat(query[name], value)
    } else {
      query[name] = value
    }
  }
  req.path = path
  req.query = query
}
