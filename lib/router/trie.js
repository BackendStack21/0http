/**
 * Trie router: a segment-trie matcher with compile-on-demand static lookups.
 *
 * Same public API, middleware executor, nested-router behaviour and error
 * containment as the sequential router, with a different matching engine:
 *   - string routes are literal: no regex is built or executed for them;
 *     the path is walked segment by segment through a trie, and every
 *     matching route/middleware still chains in registration order
 *   - fully static routes resolve through a per-path table compiled the first
 *     time they are hit (bounded by the number of registered routes, so there
 *     is no attacker-growable cache to size or evict)
 *   - no `lru-cache`, `trouter` or `regexparam` on the request path
 *
 * Security defaults differ from the sequential router on purpose:
 *   - matching is case-sensitive (`caseSensitive: false` opts out and folds
 *     ASCII letters only, so lengths never change) so the router agrees with
 *     proxies, WAFs and auth layers about what was hit
 *   - a static segment never has regex meaning (`/a+b` matches `/a+b` only)
 *   - params objects have a null prototype chain (no Object.prototype)
 *   - a path that does not start with '/' matches nothing
 *
 * Pattern syntax: `/static`, `/:param`, `/:param?` (optional; absent params
 * are not present on req.params), `/:name.ext` (param with literal suffix,
 * `/:name.ext?` to make it optional), a trailing `/*` (rest of the path, may
 * be empty) and RegExp patterns (named groups become params). A `*` that is
 * not the last segment, or a `?` that is not the last character of a param
 * segment, is rejected at registration. Empty route segments are ignored. A
 * trailing slash on the request is ignored unless `ignoreTrailingSlash: false`,
 * in which case a route registered as `/dir/` matches `/dir/` only.
 */
const next = require('./../next')
const queryparams = require('./../utils/queryparams')
const { dispatchError, runDefaultRoute } = next

const DEFAULT_ROUTE = (req, res) => {
  res.statusCode = 404
  res.end()
}

const DEFAULT_ERROR_HANDLER = (err, req, res) => {
  // Safe by default: only expose error details in explicit development mode.
  if (res.headersSent) {
    try { res.end() } catch (_) { res.destroy() }
    return
  }
  res.statusCode = 500
  res.setHeader('Content-Type', 'text/plain')
  res.end(process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error')
}

const generateId = () => Math.random().toString(36).slice(2, 10).toUpperCase()

const HTTP_METHODS = ['GET', 'HEAD', 'PATCH', 'OPTIONS', 'CONNECT', 'DELETE', 'TRACE', 'POST', 'PUT']

// Only these method tokens get a slot in the compiled static table: the table
// must stay bounded by registered routes, never by what a client sends.
const CACHEABLE_METHODS = new Set(HTTP_METHODS)

/**
 * Params objects: null prototype chain (no Object.prototype, so a route param
 * named `__proto__` or `constructor` can never reach shared state) but created
 * through a constructor so V8 keeps them in fast mode. Object.create(null)
 * yields dictionary-mode objects, several times slower to build and read.
 */
function Params () {}
Params.prototype = Object.freeze(Object.create(null))

// Shared, immutable "no params" result; identity-checked on the hot path.
const EMPTY_PARAMS = Object.freeze(new Params())
const EMPTY_KEYS = Object.freeze([])

// Own-property copy; measurably cheaper than Object.assign for tiny objects.
const copyInto = (dst, src) => {
  for (const k in src) dst[k] = src[k]
  return dst
}

const SLASH = 47 // '/'

/**
 * Static children are kept in two parallel arrays (`keys`/`nodes`) so the
 * walk can compare a segment in place with `startsWith(key, pos)` and never
 * has to allocate a substring for static segments. Nodes have few children
 * in practice, so a linear scan with a length check first beats hashing.
 */
const createNode = () => ({
  keys: [], // static segments, parallel to `nodes`
  nodes: [],
  params: null, // [{ suffix, node }], tried after the static children
  wildcard: null, // node matching the rest of the path
  prefix: null, // use() entries: apply to this node and everything below
  exact: null // route entries: apply when the path ends at this node
})

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ASCII-only case folding: never changes the string length, so capture
// offsets stay valid on the original path (unlike String#toLowerCase, which
// maps e.g. U+0130 to two code units and U+212A to ASCII 'k').
const asciiLower = (s) => /[A-Z]/.test(s) ? s.replace(/[A-Z]+/g, (m) => m.toLowerCase()) : s

/**
 * Split a route string into segments, dropping empty ones (`/a//b` → a, b).
 */
const splitRoute = (route) => {
  const out = []
  for (const seg of route.split('/')) if (seg !== '') out.push(seg)
  return out
}

/**
 * Validate a route and expand optional params (`:id?`) into every concrete
 * segment list, most specific first (a present param beats an absent one at
 * every position, earlier positions first). A route with k optional params
 * yields 2^k variants; k is author-controlled. Variants share one `seq` and
 * `find` keeps only the most specific one that matches.
 */
const expandRoute = (segments) => {
  const variants = []
  const walkSeg = (i, acc) => {
    if (i === segments.length) { variants.push(acc); return }
    const seg = segments[i]
    const c = seg.charCodeAt(0)
    if (c === 42) { // '*'
      if (i !== segments.length - 1) throw new TypeError('"*" must be the last segment of a route')
      walkSeg(i + 1, acc.concat(seg))
      return
    }
    if (c === 58) { // ':'
      const q = seg.indexOf('?', 1)
      if (q !== -1 && q !== seg.length - 1) throw new TypeError('"?" must be the last character of an optional param segment')
      if (q !== -1) {
        walkSeg(i + 1, acc.concat(seg.slice(0, q)))
        walkSeg(i + 1, acc)
        return
      }
    }
    walkSeg(i + 1, acc.concat(seg))
  }
  walkSeg(0, [])
  return variants
}

const keysOf = (segments) => {
  const keys = []
  for (const seg of segments) {
    const c = seg.charCodeAt(0)
    if (c === 42) { keys.push('*'); break }
    if (c === 58) {
      const dot = seg.indexOf('.', 1)
      keys.push(dot === -1 ? seg.slice(1) : seg.slice(1, dot))
    }
  }
  return keys
}

const normalizeRegExp = (pattern) => {
  // 'g'/'y' mutate lastIndex across exec calls: strip them, keep the rest.
  return pattern.global || pattern.sticky
    ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
    : pattern
}

module.exports = (config = {}) => {
  const {
    defaultRoute = DEFAULT_ROUTE,
    errorHandler = DEFAULT_ERROR_HANDLER,
    id = generateId(),
    caseSensitive = true,
    ignoreTrailingSlash = true
  } = config

  const root = createNode()
  const regexRoutes = [] // RegExp patterns, tested after the trie
  const routers = Object.create(null) // nested router id -> prefix length | RegExp | RegExp[]
  const mounts = Object.create(null) // nested router id -> every mount RegExp
  const staticTable = new Map() // normalized static path -> { gen, byMethod }
  let seq = 0
  let generation = 0 // bumped on every registration; stale buckets recompile

  const normalizeCase = caseSensitive ? (s) => s : asciiLower

  // ---------------------------------------------------------------- insert

  const insertVariant = (segments, loose, entry) => {
    let node = root
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const c = seg.charCodeAt(0)
      if (c === 42) { // '*': rest of the path, always last (validated)
        node = node.wildcard ??= createNode()
      } else if (c === 58) { // ':'
        const dot = seg.indexOf('.', 1)
        const suffix = dot === -1 ? '' : normalizeCase(seg.slice(dot))
        node.params ??= []
        let p = node.params.find(p => p.suffix === suffix)
        if (p === undefined) {
          p = { suffix, node: createNode() }
          // Longer suffixes first so `.tar.gz` is tried before `.gz`.
          node.params.push(p)
          node.params.sort((a, b) => b.suffix.length - a.suffix.length)
        }
        node = p.node
      } else {
        const key = normalizeCase(seg)
        const idx = node.keys.indexOf(key)
        if (idx === -1) {
          const child = createNode()
          node.keys.push(key)
          node.nodes.push(child)
          node = child
        } else {
          node = node.nodes[idx]
        }
      }
    }
    if (loose) (node.prefix ??= []).push(entry)
    else (node.exact ??= []).push(entry)
  }

  const register = (method, pattern, handlers, loose) => {
    const routeSeq = seq++
    handlers = handlers.flat()
    if (pattern instanceof RegExp) {
      regexRoutes.push({ seq: routeSeq, rank: 0, method, handlers, pattern: normalizeRegExp(pattern), keys: EMPTY_KEYS, slash: false })
    } else {
      if (typeof pattern !== 'string') throw new TypeError('Route pattern must be a string or RegExp')
      // Only meaningful with ignoreTrailingSlash: false; root is never "slashed".
      const slash = !loose && pattern.length > 1 && pattern.charCodeAt(pattern.length - 1) === SLASH
      const variants = expandRoute(splitRoute(pattern))
      for (let rank = 0; rank < variants.length; rank++) {
        const segments = variants[rank]
        const keys = keysOf(segments)
        insertVariant(segments, loose, { seq: routeSeq, rank, method, handlers, keys: keys.length ? keys : EMPTY_KEYS, slash })
        if (!loose && keys.length === 0) {
          const key = normalizeCase('/' + segments.join('/'))
          if (ignoreTrailingSlash) {
            if (!staticTable.has(key)) staticTable.set(key, { gen: -1, byMethod: null })
            if (key !== '/' && !staticTable.has(key + '/')) staticTable.set(key + '/', { gen: -1, byMethod: null })
          } else {
            const k = slash ? key + '/' : key
            if (!staticTable.has(k)) staticTable.set(k, { gen: -1, byMethod: null })
          }
        }
      }
    }
    // Any new entry can change what an already compiled static path chains:
    // buckets compiled under an older generation recompile on their next hit.
    generation++
  }

  // ----------------------------------------------------------------- match

  // Scratch state for the synchronous, non-reentrant matcher: no per-request
  // allocation for captures or candidates. Slots are addressed by counters;
  // `length` is never reassigned (that is a slow runtime call in V8).
  const caps = []
  const outEntries = []
  const outParams = []
  let outN = 0

  // mode: 0 = any entry, 1 = only entries registered without a trailing
  // slash, 2 = only entries registered with one (ignoreTrailingSlash: false).
  const collect = (list, method, isHEAD, mode) => {
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      const m = e.method
      if (m !== method && m !== '' && !(isHEAD && m === 'GET')) continue
      if (mode !== 0 && e.slash !== (mode === 2)) continue
      let params = null
      const keys = e.keys
      if (keys.length !== 0) {
        params = new Params()
        for (let j = 0; j < keys.length; j++) params[keys[j]] = caps[j]
      }
      outEntries[outN] = e
      outParams[outN] = params
      outN++
    }
  }

  // `path` is the (case-folded) string being matched; captures are sliced
  // from `src`, the original path, which has identical offsets. `depth` is
  // the number of captures taken so far (caps[0..depth)).
  const walk = (node, path, src, pos, len, method, isHEAD, depth) => {
    if (node.prefix !== null) collect(node.prefix, method, isHEAD, 0)
    // pos > len: the whole path was consumed. pos === len: a trailing slash
    // was just consumed and nothing follows.
    if (pos >= len) {
      if (node.exact !== null) {
        collect(node.exact, method, isHEAD, ignoreTrailingSlash ? 0 : (pos > len ? 1 : 2))
      }
      if (node.wildcard !== null) {
        caps[depth] = ''
        walk(node.wildcard, path, src, len + 1, len, method, isHEAD, depth + 1)
      }
      return
    }
    let end = path.indexOf('/', pos)
    if (end === -1) end = len
    const nextPos = end + 1
    const slen = end - pos

    // Static children: in-place comparison, no substring allocation.
    const keys = node.keys
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (key.length === slen && path.startsWith(key, pos)) {
        walk(node.nodes[i], path, src, nextPos, len, method, isHEAD, depth)
        break // keys are unique per node
      }
    }

    if (node.params !== null && slen !== 0) {
      const params = node.params
      for (let i = 0; i < params.length; i++) {
        const p = params[i]
        const sfx = p.suffix.length
        if (sfx === 0) {
          caps[depth] = src.slice(pos, end)
        } else if (slen > sfx && path.endsWith(p.suffix, end)) {
          caps[depth] = src.slice(pos, end - sfx)
        } else {
          continue
        }
        walk(p.node, path, src, nextPos, len, method, isHEAD, depth + 1)
      }
    }

    if (node.wildcard !== null) {
      caps[depth] = src.slice(pos)
      walk(node.wildcard, path, src, len + 1, len, method, isHEAD, depth + 1)
    }
  }

  const find = (method, path) => {
    const len = path.length
    // Only '' (root) and paths starting with '/' can match anything.
    if (len !== 0 && path.charCodeAt(0) !== SLASH) return { params: EMPTY_PARAMS, handlers: [] }
    const matchPath = caseSensitive ? path : asciiLower(path)
    const isHEAD = method === 'HEAD'
    outN = 0
    // Start after the leading slash; '' and '/' start "exhausted" so root
    // routes match them.
    walk(root, matchPath, path, len <= 1 ? len + 1 : 1, len, method, isHEAD, 0)

    if (regexRoutes.length !== 0) {
      for (let i = 0; i < regexRoutes.length; i++) {
        const r = regexRoutes[i]
        const m = r.method
        if (m !== method && m !== '' && !(isHEAD && m === 'GET')) continue
        const matches = r.pattern.exec(path)
        if (matches === null) continue
        let params = null
        if (matches.groups !== undefined) {
          params = new Params()
          for (const k in matches.groups) params[k] = matches.groups[k]
        }
        outEntries[outN] = r
        outParams[outN] = params
        outN++
      }
    }

    let n = outN
    if (n === 0) return { params: EMPTY_PARAMS, handlers: [] }

    // Registration order decides the chain: insertion sort, n is tiny.
    for (let i = 1; i < n; i++) {
      const e = outEntries[i]; const p = outParams[i]
      let j = i - 1
      while (j >= 0 && outEntries[j].seq > e.seq) {
        outEntries[j + 1] = outEntries[j]; outParams[j + 1] = outParams[j]; j--
      }
      outEntries[j + 1] = e; outParams[j + 1] = p
    }

    // Variants of one registration (optional params) share a seq: keep only
    // the most specific match so a route or middleware never runs twice.
    let w = 0
    for (let i = 0; i < n; i++) {
      const e = outEntries[i]
      if (w !== 0 && outEntries[w - 1].seq === e.seq) {
        const kept = outEntries[w - 1]
        if (e.keys.length > kept.keys.length || (e.keys.length === kept.keys.length && e.rank < kept.rank)) {
          outEntries[w - 1] = e
          outParams[w - 1] = outParams[i]
        }
        outParams[i] = null
        continue
      }
      outEntries[w] = e
      outParams[w] = outParams[i]
      w++
    }
    n = w

    const handlers = []
    let params = EMPTY_PARAMS
    for (let i = 0; i < n; i++) {
      const hs = outEntries[i].handlers
      for (let j = 0; j < hs.length; j++) handlers.push(hs[j])
      const p = outParams[i]
      if (p !== null) {
        if (params === EMPTY_PARAMS) params = p
        else copyInto(params, p) // later routes override, as before
        outParams[i] = null // never retain request data between lookups
      }
    }
    return { params, handlers }
  }

  // ---------------------------------------------------------------- public

  const router = {
    id,
    find,
    routes: regexRoutes // informational: RegExp routes only
  }

  router.add = (method, pattern, ...handlers) => {
    register(method, pattern, handlers, false)
    return router
  }
  router.all = router.add.bind(router, '')
  for (const method of HTTP_METHODS) router[method.toLowerCase()] = router.add.bind(router, method)
  router.on = (method, pattern, ...handlers) => router.add(method, pattern, handlers)

  // RegExp used by the executor to strip a string mount prefix from the path.
  const prefixRegExp = (segments) => {
    const source = segments.map(s => {
      const c = s.charCodeAt(0)
      if (c === 42) return '(?:\\/(.*))?'
      if (c === 58) return s.indexOf('?', 1) !== -1 ? '(?:\\/[^/]+)?' : '\\/[^/]+'
      return '\\/' + escapeRegExp(s)
    }).join('')
    return new RegExp('^' + source + '(?=$|\\/)', caseSensitive ? '' : 'i')
  }

  router.use = (prefix, ...middlewares) => {
    if (typeof prefix === 'function') {
      middlewares = [prefix, ...middlewares]
      prefix = '/'
    }
    if (prefix instanceof RegExp) prefix = normalizeRegExp(prefix)
    register('', prefix, middlewares, true)

    const first = middlewares[0]
    if (first?.id) {
      // Nested router: tell the executor how to strip the prefix from the path.
      let single
      let regex
      if (prefix instanceof RegExp) {
        single = regex = prefix
      } else {
        const segments = splitRoute(prefix)
        regex = prefixRegExp(segments)
        const dynamic = segments.some(s => s.charCodeAt(0) === 58 || s.charCodeAt(0) === 42)
        // Static prefixes strip by normalized length ('/a///b' matches '/a/b').
        single = dynamic ? regex : ('/' + segments.join('/')).length
      }
      const list = mounts[first.id] ??= []
      list.push(regex)
      // Mounted once: cheapest form. Mounted at several prefixes: the
      // executor picks the first mount RegExp that matches the path.
      routers[first.id] = list.length === 1 ? single : list
    }
    return router
  }

  // Nested-router restore helpers: identical contract to the sequential router.
  const restoreNestedUrlContext = (req, context) => {
    if (context.hasUrlContext) {
      req.url = context.url
      req.path = context.path
      delete req.preRouterUrl
      delete req.preRouterPath
    }
  }

  const createCleanupMiddleware = (step, context) => (req, res, next) => {
    restoreNestedUrlContext(req, context)
    req.params = context.params
    return step()
  }

  router.lookup = (req, res, step) => {
    req.url ??= '/'
    req.originalUrl ??= req.url
    if (typeof req.url !== 'string') req.url = String(req.url)

    queryparams(req, req.url)

    const path = req.path
    const method = req.method
    let match
    let shared = false // true when `match` lives in the static table
    const bucket = staticTable.get(caseSensitive ? path : asciiLower(path))
    if (bucket !== undefined) {
      if (bucket.gen !== generation) {
        bucket.byMethod = Object.create(null)
        bucket.gen = generation
      }
      match = bucket.byMethod[method]
      if (match === undefined) {
        match = find(method, path)
        // Case-folded keys can map differently cased requests to one slot: a
        // match carrying captures is specific to this request, so only
        // parameter-less matches are shared in that mode.
        if (CACHEABLE_METHODS.has(method) && (caseSensitive || match.params === EMPTY_PARAMS)) {
          bucket.byMethod[method] = match
          shared = true
        }
      } else {
        shared = true
      }
    } else {
      match = find(method, path)
    }

    const { handlers, params } = match
    const activeErrorHandler = step?.errorHandler || errorHandler
    if (handlers.length === 0) {
      return runDefaultRoute(defaultRoute, req, res, activeErrorHandler)
    }

    // Per-level params: a fresh object per request, never a shared one. A
    // match that did not come from the table was built for this request only,
    // so its params object can be handed over without copying.
    const inherited = req.params
    if (inherited === undefined) {
      req.params = params === EMPTY_PARAMS ? new Params() : (shared ? copyInto(new Params(), params) : params)
    } else {
      req.params = copyInto(copyInto(new Params(), inherited), params)
    }

    if (step === undefined && req.preRouterUrl === undefined) {
      return next(handlers, req, res, 0, routers, defaultRoute, errorHandler)
    }

    const context = {
      hasUrlContext: req.preRouterUrl !== undefined,
      url: req.preRouterUrl,
      path: req.preRouterPath,
      params: inherited
    }

    let middlewares = handlers
    if (step !== undefined) {
      middlewares = handlers.slice()
      middlewares.push(createCleanupMiddleware(step, context))
    }

    // When this router is used as a nested router, the parent executor passes
    // a step function that carries the parent's error handler. Use the
    // parent's error handler so errors bubble up. Restore the URL context
    // before invoking it; a throwing handler can never take the process down.
    const errorHandlerWithCleanup = (err, req, res) => {
      restoreNestedUrlContext(req, context)
      return dispatchError(activeErrorHandler, err, req, res)
    }

    return next(middlewares, req, res, 0, routers, defaultRoute, errorHandlerWithCleanup)
  }

  return router
}
