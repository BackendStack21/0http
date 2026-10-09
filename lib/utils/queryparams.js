// Pre-create Set for dangerous properties - faster O(1) lookup vs string comparisons
const DANGEROUS_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype'])

// Pre-created empty query object to avoid allocations
const EMPTY_QUERY = Object.freeze(Object.create(null))

/**
 * Store one parsed parameter, applying the prototype-pollution guard and the
 * repeated-name → array rule. Shared by both parsing strategies below.
 */
function assign (query, name, value) {
  // Prototype-pollution guard. The segment split/filter allocates per
  // parameter, so it only runs for the rare names that could actually carry a
  // dangerous segment. Every dangerous key ('__proto__', 'prototype',
  // 'constructor') contains 'proto' or 'constructor' as a substring.
  if (name.indexOf('proto') !== -1 || name.indexOf('constructor') !== -1) {
    // Split parameter name into segments by dot or bracket notation
    /* eslint-disable-next-line */
    const segments = name.split(/[\.\[\]]+/).filter(Boolean)
    if (segments.some(segment => DANGEROUS_PROPERTIES.has(segment))) {
      return // Skip dangerous property names
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

/**
 * True when the WHATWG application/x-www-form-urlencoded parser would return
 * every name and value byte-for-byte unchanged: no percent-escapes (`%`), no
 * plus-to-space (`+`), and no surrogates (which its UTF-8 round-trip would
 * rewrite). For such strings the structural split below is exact.
 */
function isPlain (search) {
  for (let i = 0; i < search.length; i++) {
    const c = search.charCodeAt(i)
    if (c === 37 || c === 43 || (c >= 0xD800 && c <= 0xDFFF)) return false
  }
  return true
}

/**
 * Structural parse for plain strings, mirroring URLSearchParams exactly:
 * one leading `?` is dropped, empty `&`-separated sequences are skipped, a
 * sequence without `=` yields an empty value, and only the first `=` splits.
 */
function parsePlain (search, query) {
  const len = search.length
  let start = search.charCodeAt(0) === 63 ? 1 : 0 // 63 is '?'
  // Track the next '=' instead of rescanning from every segment: a query like
  // `a&a&a&...&=` would otherwise cost O(n^2) in the number of segments.
  let eq = search.indexOf('=', start)
  while (start <= len) {
    let end = search.indexOf('&', start)
    if (end === -1) end = len
    if (end > start) {
      if (eq !== -1 && eq < start) eq = search.indexOf('=', start)
      if (eq === -1 || eq >= end) {
        assign(query, search.slice(start, end), '')
      } else {
        assign(query, search.slice(start, eq), search.slice(eq + 1, end))
      }
    }
    start = end + 1
  }
}

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
  let search = url.slice(questionMarkIndex + 1)

  if (search.length === 0) {
    // Fast path: empty query string
    req.query = query
    return
  }

  // Only rewrite array notation (a[]=1 -> a=1) when it is actually present,
  // avoiding a regex scan/allocation on the common query-string case.
  if (search.indexOf('[]=') !== -1) search = search.replace(/\[\]=/g, '=')

  if (isPlain(search)) {
    parsePlain(search, query)
  } else {
    // Decoding needed: defer to the spec-compliant parser.
    for (const [name, value] of new URLSearchParams(search).entries()) {
      assign(query, name, value)
    }
  }

  req.query = query
}
