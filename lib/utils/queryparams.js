module.exports = (req, url) => {
  const [path, search = ''] = url.split('?')
  const searchParams = new URLSearchParams(search.replace(/\[\]=/g, '='))

  const query = {}
  for (const [name, value] of searchParams.entries()) {
    if (query[name]) {
      Array.isArray(query[name]) ? query[name].push(value) : (query[name] = [query[name], value])
    } else {
      query[name] = value
    }
  }

  req.path = path
  req.query = query
}
