#!/usr/bin/env node
/**
 * Deep Security Audit for 0http
 * Probes edge cases and real-world exploit scenarios beyond the standard pentest.
 */

const sequential = require('../lib/router/sequential')
const zero = require('../index')

let total = 0
let passed = 0
let failed = 0
const findings = []

function report (name, check, severity = 'INFO', details = '') {
  total++
  if (check) {
    passed++
  } else {
    failed++
    findings.push({ name, severity, details })
  }
  const marker = check ? '✓' : '✗'
  console.log(`  ${marker} [${severity.padEnd(8)}] ${name}${details ? ' — ' + details : ''}`)
}

function resetProto () {
  delete Object.prototype.polluted
  delete Object.prototype.isAdmin
  delete Object.prototype.role
}

function createMockReq (method, reqUrl, headers = {}) {
  return { method, url: reqUrl, headers }
}

function createMockRes () {
  const headers = {}
  let body = ''
  const res = {
    statusCode: 200,
    finished: false,
    setHeader: (k, v) => { headers[k] = v },
    getHeader: (k) => headers[k],
    removeHeader: (k) => { delete headers[k] },
    writeHead: (code, hdrs) => {
      res.statusCode = code
      if (hdrs) Object.assign(headers, hdrs)
    },
    end: (chunk) => {
      if (chunk) body += chunk
      res.finished = true
    },
    getHeaders: () => ({ ...headers })
  }
  Object.defineProperty(res, '_body', { get: () => body, enumerable: true })
  return res
}

// ═══════════════════════════════════════════════════════════════
// 1. PROTOTYPE POLLUTION VIA ROUTE PARAMETERS
// ═══════════════════════════════════════════════════════════════

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ 1. PROTOTYPE POLLUTION VIA ROUTE PARAMETERS     │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  resetProto()
  const router = sequential()
  router.get('/:__proto__', (req, res) => {
    res.end('ok')
  })
  const req = createMockReq('GET', '/pollute')
  const res = createMockRes()
  router.lookup(req, res)
  report('PP-RP-1: __proto__ route param does not pollute Object.prototype',
    !Object.prototype.polluted, 'CRITICAL',
    Object.prototype.polluted ? 'Object.prototype.polluted set' : '')
})()

;(() => {
  resetProto()
  const router = sequential()
  router.get('/:constructor', (req, res) => {
    res.end('ok')
  })
  const req = createMockReq('GET', '/pollute')
  const res = createMockRes()
  router.lookup(req, res)
  report('PP-RP-2: constructor route param does not pollute Object.prototype',
    !Object.prototype.polluted, 'CRITICAL',
    Object.prototype.polluted ? 'Object.prototype.polluted set' : '')
})()

;(() => {
  resetProto()
  const router = sequential()
  router.get('/:role/:__proto__', (req, res) => {
    res.end('ok')
  })
  const req = createMockReq('GET', '/user/pollute')
  const res = createMockRes()
  router.lookup(req, res)
  report('PP-RP-3: __proto__ as second route param is safe',
    !Object.prototype.polluted, 'CRITICAL',
    Object.prototype.polluted ? 'Object.prototype.polluted set' : '')
})()

;(() => {
  resetProto()
  const router = sequential()
  // Regex route with named group __proto__
  router.get(/^\/(?<__proto__>[^/]+)$/, (req, res) => {
    res.end('ok')
  })
  const req = createMockReq('GET', '/pollute')
  const res = createMockRes()
  router.lookup(req, res)
  report('PP-RP-4: __proto__ regex named group does not pollute',
    !Object.prototype.polluted, 'CRITICAL',
    Object.prototype.polluted ? 'Object.prototype.polluted set' : '')
})()

// ═══════════════════════════════════════════════════════════════
// 2. NESTED ROUTER STATE CORRUPTION ON ERROR
// ═══════════════════════════════════════════════════════════════

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ 2. NESTED ROUTER STATE CORRUPTION ON ERROR      │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const parent = sequential()
  const child = sequential()
  let capturedUrl = null
  let capturedOriginalUrl = null

  child.get('/crash', (req, res) => {
    throw new Error('boom')
  })

  parent.use('/api', child)

  const errorHandler = (err, req, res) => {
    if (!err) console.error('expected an error but got none')
    capturedUrl = req.url
    capturedOriginalUrl = req.originalUrl
    res.statusCode = 500
    res.end('error')
  }

  // Need to recreate router with custom error handler
  const router = sequential({ errorHandler })
  const nested = sequential()
  nested.get('/crash', (req, res) => {
    throw new Error('boom')
  })
  router.use('/api', nested)

  const req = createMockReq('GET', '/api/crash')
  const res = createMockRes()
  router.lookup(req, res)

  report('NR-ERR-1: req.url restored after sync error in nested router',
    capturedUrl === '/api/crash', 'HIGH',
    `req.url was ${capturedUrl}, expected /api/crash`)
  report('NR-ERR-2: req.originalUrl preserved after sync error in nested router',
    capturedOriginalUrl === '/api/crash', 'MEDIUM',
    `req.originalUrl was ${capturedOriginalUrl}`)
})()

;(() => {
  const errorHandler = (err, req, res) => {
    if (!err) console.error('expected an error but got none')
    req._capturedUrl = req.url
    req._capturedPath = req.path
    res.statusCode = 500
    res.end('error')
  }
  const router = sequential({ errorHandler })
  const nested = sequential()
  nested.get('/async-crash', async (req, res) => {
    throw new Error('async boom')
  })
  router.use('/api', nested)

  const req = createMockReq('GET', '/api/async-crash')
  const res = createMockRes()
  router.lookup(req, res)

  // Async error handling needs a tick
  setImmediate(() => {
    report('NR-ERR-3: req.url restored after async error in nested router',
      req._capturedUrl === '/api/async-crash', 'HIGH',
      `req.url was ${req._capturedUrl}, expected /api/async-crash`)
  })
})()

;(() => {
  const errorHandler = (err, req, res) => {
    if (!err) console.error('expected an error but got none')
    req._capturedUrl = req.url
    res.statusCode = 500
    res.end('error')
  }
  const router = sequential({ errorHandler })
  const nested = sequential()
  nested.get('/next-error', (req, res, next) => {
    next(new Error('next error'))
  })
  router.use('/api', nested)

  const req = createMockReq('GET', '/api/next-error')
  const res = createMockRes()
  router.lookup(req, res)

  report('NR-ERR-4: req.url restored after next(error) in nested router',
    req._capturedUrl === '/api/next-error', 'HIGH',
    `req.url was ${req._capturedUrl}, expected /api/next-error`)
})()

// ═══════════════════════════════════════════════════════════════
// 3. CASE-SENSITIVITY / ACCESS CONTROL BYPASS
// ═══════════════════════════════════════════════════════════════

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ 3. CASE-SENSITIVITY ROUTING                     │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const router = sequential()
  let hits = 0
  router.get('/admin', (req, res) => {
    hits++
    res.end('admin')
  })

  const cases = ['/admin', '/ADMIN', '/Admin', '/aDmIn']
  for (const c of cases) {
    const req = createMockReq('GET', c)
    const res = createMockRes()
    router.lookup(req, res)
  }

  report('CS-1: Routes are case-insensitive by default',
    hits === 4, 'INFO',
    `Matched ${hits}/4 cases — may be a security concern if case-sensitive paths are expected`)
})()

// ═══════════════════════════════════════════════════════════════
// 4. ROUTE PARAMETER OVERLAP WITH INTRINSIC PROPERTIES
// ═══════════════════════════════════════════════════════════════

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ 4. ROUTE PARAM / INTRINSIC PROPERTY OVERLAP     │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const router = sequential()
  router.get('/:toString', (req, res) => {
    res.end(typeof req.params.toString)
  })
  const req = createMockReq('GET', '/hello')
  const res = createMockRes()
  router.lookup(req, res)
  report('IP-1: toString route param does not break params object',
    res._body === 'string', 'MEDIUM',
    `Got ${res._body}`)
})()

;(() => {
  const router = sequential()
  router.get('/:hasOwnProperty', (req, res) => {
    res.end(typeof req.params.hasOwnProperty)
  })
  const req = createMockReq('GET', '/hello')
  const res = createMockRes()
  router.lookup(req, res)
  report('IP-2: hasOwnProperty route param does not break params object',
    res._body === 'string', 'MEDIUM',
    `Got ${res._body}`)
})()

// ═══════════════════════════════════════════════════════════════
// 5. CACHE KEY TYPE CONFUSION
// ═══════════════════════════════════════════════════════════════

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ 5. CACHE KEY TYPE CONFUSION                     │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const router = sequential({ cacheSize: 100 })
  router.get('/test', (req, res) => res.end('ok'))

  let error = null
  try {
    const req = createMockReq(undefined, '/test')
    const res = createMockRes()
    router.lookup(req, res)
  } catch (e) {
    error = e.message
  }
  report('CK-1: Undefined method does not crash router',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential({ cacheSize: 100 })
  router.get('/test', (req, res) => res.end('ok'))

  let error = null
  try {
    const req = { method: 'GET', url: '/test', path: {} }
    const res = createMockRes()
    router.lookup(req, res)
  } catch (e) {
    error = e.message
  }
  report('CK-2: Non-string path does not crash router',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

// ═══════════════════════════════════════════════════════════════
// 6. NESTED ROUTER URL REPLACEMENT EDGE CASES
// ═══════════════════════════════════════════════════════════════

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ 6. NESTED ROUTER URL REPLACEMENT                │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const parent = sequential()
  const child = sequential()
  let capturedUrl = null

  child.get('/item', (req, res) => {
    capturedUrl = req.url
    res.end('ok')
  })

  parent.use('/api/v1', child)

  const req = createMockReq('GET', '/api/v1/item')
  const res = createMockRes()
  parent.lookup(req, res)

  report('NR-URL-1: Static prefix stripped correctly',
    capturedUrl === '/item', 'LOW',
    `Got ${capturedUrl}`)
})()

;(() => {
  const parent = sequential()
  const child = sequential()
  let capturedUrl = null

  child.get('/item', (req, res) => {
    capturedUrl = req.url
    res.end('ok')
  })

  parent.use('/:version', child)

  const req = createMockReq('GET', '/v1/item')
  const res = createMockRes()
  parent.lookup(req, res)

  report('NR-URL-2: Dynamic prefix stripped correctly',
    capturedUrl === '/item', 'LOW',
    `Got ${capturedUrl}`)
})()

// ═══════════════════════════════════════════════════════════════
// 7. FULL-SERVER INTEGRATION: REAL HTTP REQUESTS
// ═══════════════════════════════════════════════════════════════

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ 7. FULL-SERVER INTEGRATION                      │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const { router, server } = zero()

  const child = require('../lib/router/sequential')()
  child.get('/crash', (req, res) => {
    throw new Error('server boom')
  })

  router.use('/api', child)

  router.on = router.on || router.add
  server.listen(0, () => {
    const port = server.address().port
    const http = require('http')
    const req = http.get(`http://127.0.0.1:${port}/api/crash`, (res) => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        report('FS-1: Server handles nested router sync error without crash',
          res.statusCode === 500 && body === 'Internal Server Error', 'HIGH',
          `Status ${res.statusCode}, body ${body}`)
        server.close()
      })
    })
    req.on('error', (err) => {
      report('FS-1: Server handles nested router sync error without crash',
        false, 'HIGH', `Request failed: ${err.message}`)
      server.close()
    })
  })
})()

// ═══════════════════════════════════════════════════════════════
// 8. REPORT
// ═══════════════════════════════════════════════════════════════

setTimeout(() => {
  console.log('\n\n┌─────────────────────────────────────────────────┐')
  console.log('│          DEEP SECURITY AUDIT REPORT             │')
  console.log('└─────────────────────────────────────────────────┘')
  console.log(`\n  Total: ${total} | Passed: ${passed} | Failed: ${failed}`)

  if (findings.length > 0) {
    console.log('\n  Findings:')
    for (const f of findings) {
      console.log(`    [${f.severity}] ${f.name}`)
      if (f.details) console.log(`             ${f.details}`)
    }
  }

  if (failed > 0) {
    console.log('\n  ❌ ISSUES FOUND')
    process.exit(1)
  } else {
    console.log('\n  ✅ ALL DEEP CHECKS PASSED')
    process.exit(0)
  }
}, 500)
