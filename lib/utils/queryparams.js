// Pre-create Set for dangerous properties - faster O(1) lookup vs string comparisons
const DANGEROUS_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype'])

// Pre-created empty query object to avoid allocations
const EMPTY_QUERY = Object.freeze(Object.create(null))

module.exports = (req, url) => {
  // Single indexOf call - more efficient than multiple operations
  const questionMarkIndex = url.indexOf('?')

  if (questionMarkIndex === -1) {
    // Fast path: no query string
    req.path = url
    req.query = EMPTY_QUERY
    return
  }

  // Use Object.create(null) for prototype pollution protection
  const query = Object.create(null)

  // Extract path and search in one operation each
  req.path = url.slice(0, questionMarkIndex)
  const search = url.slice(questionMarkIndex + 1)

  if (search.length === 0) {
    // Fast path: empty query string
    req.query = query
    return
  }

  // Only rewrite array notation (a[]=1 -> a=1) when it is actually present,
  // avoiding a regex scan/allocation on the common query-string case.
  const searchParams = new URLSearchParams(
    search.indexOf('[]=') === -1 ? search : search.replace(/\[\]=/g, '=')
  )

  for (const [name, value] of searchParams.entries()) {
    // Prototype-pollution guard. The segment split/filter allocates per
    // parameter, so it only runs for the rare names that could actually carry a
    // dangerous segment. Every dangerous key ('__proto__', 'prototype',
    // 'constructor') contains 'proto' or 'constructor' as a substring.
    if (name.indexOf('proto') !== -1 || name.indexOf('constructor') !== -1) {
      // Split parameter name into segments by dot or bracket notation
      /* eslint-disable-next-line */
      const segments = name.split(/[\.\[\]]+/).filter(Boolean)
      if (segments.some(segment => DANGEROUS_PROPERTIES.has(segment))) {
        continue // Skip dangerous property names
      }
    }

    const existing = query[name]
    if (existing !== undefined) {
      // Optimized array handling - check type once, then branch
      if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        query[name] = [existing, value]
      }
    } else {
      query[name] = value
    }
  }

  req.query = query
}
