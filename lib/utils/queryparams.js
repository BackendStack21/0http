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

  // Process query parameters with optimized URLSearchParams handling
  const searchParams = new URLSearchParams(search.replace(/\[\]=/g, '='))

  for (const [name, value] of searchParams.entries()) {
    // Split parameter name into segments by dot or bracket notation
    const segments = name.split(/[\.\[\]]+/).filter(Boolean)
    
    // Check each segment against the dangerous properties set
    if (segments.some(segment => DANGEROUS_PROPERTIES.has(segment))) {
      continue // Skip dangerous property names
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
