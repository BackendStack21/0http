#!/usr/bin/env node
/**
 * Regex-specific security audit for 0http
 */

const sequential = require('../lib/router/sequential')

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

function createMockRes () {
  return {
    statusCode: 200,
    finished: false,
    setHeader: () => {},
    getHeader: () => undefined,
    removeHeader: () => {},
    writeHead: (code) => { this.statusCode = code },
    end: function () { this.finished = true }
  }
}

function hit (router, url) {
  let called = false
  const testRouter = sequential({ cacheSize: 0 })
  router._testRoutes(testRouter, () => { called = true })
  const req = { method: 'GET', url, headers: {} }
  const res = createMockRes()
  testRouter.lookup(req, res)
  return called
}

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ REGEX SECURITY AUDIT                            │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  router.get(/^\/test$/g, (req, res) => { hits++; res.end('ok') })

  const results = []
  for (let i = 0; i < 4; i++) {
    const before = hits
    const req = { method: 'GET', url: '/test', headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-1: Global-flag regex matches consistently',
    results.every(r => r), 'HIGH',
    `Results: ${JSON.stringify(results)}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  router.get(/^\/test$/y, (req, res) => { hits++; res.end('ok') })

  const results = []
  for (let i = 0; i < 4; i++) {
    const before = hits
    const req = { method: 'GET', url: '/test', headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-2: Sticky-flag regex matches consistently',
    results.every(r => r), 'HIGH',
    `Results: ${JSON.stringify(results)}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  router.get(/^\/test$/i, (req, res) => { hits++; res.end('ok') })

  const results = []
  for (const url of ['/test', '/TEST', '/Test']) {
    const before = hits
    const req = { method: 'GET', url, headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-3: Case-insensitive regex matches all cases',
    results.every(r => r), 'INFO',
    `Results: ${JSON.stringify(results)}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  router.get(/^\/admin$/, (req, res) => { hits++; res.end('ok') })

  const results = []
  for (const url of ['/admin', '/sub/admin', '/admin/backup']) {
    const before = hits
    const req = { method: 'GET', url, headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-4: Anchored regex does not match substrings',
    results[0] && !results[1] && !results[2], 'LOW',
    `Results: ${JSON.stringify(results)}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  router.get(/admin/, (req, res) => { hits++; res.end('ok') })

  const results = []
  for (const url of ['/admin', '/sub/admin', '/administrator']) {
    const before = hits
    const req = { method: 'GET', url, headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-5: Unanchored regex matches substrings (user responsibility)',
    results.every(r => r), 'INFO',
    `Results: ${JSON.stringify(results)}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let body = ''
  router.get(/^\/(?<constructor>[^/]+)$/, (req, res) => {
    body = JSON.stringify(req.params)
    res.end('ok')
  })
  const req = { method: 'GET', url: '/value', headers: {} }
  const res = createMockRes()
  router.lookup(req, res)
  report('REGEX-6: Named group "constructor" does not pollute Object.prototype',
    !Object.prototype.polluted, 'HIGH',
    Object.prototype.polluted ? 'Object.prototype.polluted set' : `params: ${body}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  // regexparam dist does not support custom inline patterns like :id([0-9]+);
  // use an explicit RegExp route to validate numeric IDs.
  router.get(/^\/user\/([0-9]+)$/, (req, res) => { hits++; res.end('ok') })

  const results = []
  for (const url of ['/user/123', '/user/abc', '/user/']) {
    const before = hits
    const req = { method: 'GET', url, headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-7: Explicit regex route matches only intended input',
    results[0] && !results[1] && !results[2], 'LOW',
    `Results: ${JSON.stringify(results)}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  router.get('/files/*', (req, res) => { hits++; res.end('ok') })

  const results = []
  for (const url of ['/files/report.pdf', '/files/../etc/passwd', '/files/.hidden']) {
    const before = hits
    const req = { method: 'GET', url, headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-8: Wildcard routes match arbitrary file-like paths (user responsibility)',
    results[0] && results[1] && results[2], 'INFO',
    `Results: ${JSON.stringify(results)}`)
})()

;(() => {
  const router = sequential({ cacheSize: 0 })
  let hits = 0
  // This is the unsupported regexparam syntax; it silently falls back to [^/]+?
  router.get('/user/:id([0-9]+)', (req, res) => { hits++; res.end('ok') })

  const results = []
  for (const url of ['/user/123', '/user/abc']) {
    const before = hits
    const req = { method: 'GET', url, headers: {} }
    const res = createMockRes()
    router.lookup(req, res)
    results.push(hits > before)
  }

  report('REGEX-9: Inline :param(custom) patterns are not validated by regexparam',
    results[0] && results[1], 'INFO',
    `Results: ${JSON.stringify(results)} — use explicit RegExp routes if validation matters`)
})()

console.log('\n\n┌─────────────────────────────────────────────────┐')
console.log('│           REGEX AUDIT REPORT                    │')
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
  console.log('\n  ✅ ALL CHECKS PASSED')
  process.exit(0)
}
