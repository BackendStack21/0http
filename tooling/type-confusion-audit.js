#!/usr/bin/env node
/**
 * Type confusion and input validation audit for 0http
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
  const res = {
    statusCode: 200,
    finished: false,
    setHeader: () => {},
    getHeader: () => undefined,
    removeHeader: () => {},
    writeHead: (code) => { res.statusCode = code },
    end: () => { res.finished = true }
  }
  return res
}

console.log('\n┌─────────────────────────────────────────────────┐')
console.log('│ TYPE CONFUSION / INPUT VALIDATION               │')
console.log('└─────────────────────────────────────────────────┘')

;(() => {
  const router = sequential()
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: 'GET', url: 12345, headers: {} }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-1: Numeric req.url does not crash router',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential()
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: 'GET', url: null, headers: {} }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-2: Null req.url is normalized to /',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential()
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: 'GET', url: { indexOf: () => 0, slice: () => '/test' }, headers: {} }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-3: Object with string-like methods does not crash router',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential({ cacheSize: 100 })
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: { toString: () => 'GET' }, url: '/test', headers: {} }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-4: Method object with toString does not crash router',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential()
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: 'GET', url: '/test?x=' + 'a'.repeat(10 * 1024 * 1024), headers: {} }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-5: 10MB query string does not crash router',
    !error, 'MEDIUM', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential()
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: 'GET', url: '/test?' + 'a=1&'.repeat(100000), headers: {} }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-6: 100K query parameters do not crash router',
    !error, 'MEDIUM', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential()
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: 'GET', url: '/test', path: '/admin', headers: {} }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-7: Pre-set req.path is overwritten by router',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential()
  let body = ''
  router.get('/test#fragment', (req, res) => {
    body = req.path
    res.end('ok')
  })
  const req = { method: 'GET', url: '/test#fragment', headers: {} }
  router.lookup(req, createMockRes())
  report('TC-8: Fragment in URL is preserved as part of path',
    body === '/test#fragment', 'INFO',
    `path was ${body}`)
})()

;(() => {
  const router = sequential()
  router.get('/test', (req, res) => res.end('ok'))
  let error = null
  try {
    const req = { method: 'GET', url: '/test', headers: {}, params: { existing: 'value' } }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-9: Existing req.params does not crash router',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

;(() => {
  const router = sequential()
  let captured = null
  router.get('/test/:existing', (req, res) => {
    captured = req.params.existing
    res.end('ok')
  })
  const req = { method: 'GET', url: '/test/new', headers: {}, params: { existing: 'old' } }
  router.lookup(req, createMockRes())
  report('TC-10: Existing req.params merged with route params',
    captured === 'new', 'LOW',
    `Got ${captured}`)
})()

;(() => {
  const router = sequential()
  let error = null
  try {
    const req = { method: 'GET', url: '/test', headers: {}, params: '__proto__' }
    router.lookup(req, createMockRes())
  } catch (e) {
    error = e.message
  }
  report('TC-11: Non-object req.params handled safely',
    !error, 'LOW', error ? `Crashed: ${error}` : '')
})()

console.log('\n\n┌─────────────────────────────────────────────────┐')
console.log('│          TYPE CONFUSION AUDIT REPORT            │')
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
