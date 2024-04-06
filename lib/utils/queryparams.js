module.exports = (req, url) => {
  const query = {}
  const indexOfQuestionMark = url.indexOf('?')
  const path = indexOfQuestionMark !== -1 ? url.slice(0, indexOfQuestionMark) : url
  const search = indexOfQuestionMark !== -1 ? url.slice(indexOfQuestionMark + 1) : ''

  if (search.length > 0) {
    const searchParams = new URLSearchParams(search.replace(/\[\]=/g, '='))
    for (const [name, value] of searchParams.entries()) {
      if (query[name]) {
        Array.isArray(query[name]) ? query[name].push(value) : (query[name] = [query[name], value])
      } else {
        query[name] = value
      }
    }
  }

  req.path = path
  req.query = query
}
