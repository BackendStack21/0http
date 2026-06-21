#!/usr/bin/env node
/**
 * Proof of Concept: Nested router req.url state corruption on error
 *
 * When a handler inside a nested router throws (or calls next(err) or rejects),
 * the parent router's cleanup middleware never runs. As a result, custom error
 * handlers see a modified req.url instead of the original request URL.
 */

const sequential = require('../lib/router/sequential')

const errorHandler = (err, req, res) => {
  console.log('Error handler saw err:', err.message)
  console.log('Error handler saw req.url:', JSON.stringify(req.url))
  console.log('Error handler saw req.originalUrl:', JSON.stringify(req.originalUrl))
  console.log('Error handler saw req.preRouterUrl:', JSON.stringify(req.preRouterUrl))
  res.statusCode = 500
  res.end('Internal Server Error')
}

const parent = sequential({ errorHandler })
const child = sequential()

child.get('/crash', (req, res) => {
  console.log('Handler saw req.url:', JSON.stringify(req.url))
  throw new Error('boom')
})

parent.use('/api', child)

console.log('=== Sync throw in nested router ===')
const req1 = { method: 'GET', url: '/api/crash', headers: {} }
const res1 = {
  statusCode: 200,
  finished: false,
  setHeader: () => {},
  end: (chunk) => { res1.finished = true; if (chunk) res1._body = chunk }
}
parent.lookup(req1, res1)
console.log('After lookup req.url:', JSON.stringify(req1.url))
console.log('Expected:          "/api/crash"')
console.log()

console.log('=== next(err) in nested router ===')
const req2 = { method: 'GET', url: '/api/next-error', headers: {} }
const res2 = {
  statusCode: 200,
  finished: false,
  setHeader: () => {},
  end: (chunk) => { res2.finished = true; if (chunk) res2._body = chunk }
}
const child2 = sequential()
child2.get('/next-error', (req, res, next) => {
  next(new Error('next error'))
})
const parent2 = sequential({ errorHandler })
parent2.use('/api', child2)
parent2.lookup(req2, res2)
console.log('After lookup req.url:', JSON.stringify(req2.url))
console.log('Expected:          "/api/next-error"')
console.log()

console.log('=== Async rejection in nested router ===')
const req3 = { method: 'GET', url: '/api/async-crash', headers: {} }
const res3 = {
  statusCode: 200,
  finished: false,
  setHeader: () => {},
  end: (chunk) => { res3.finished = true; if (chunk) res3._body = chunk }
}
const child3 = sequential()
child3.get('/async-crash', async (req, res) => {
  throw new Error('async boom')
})
const parent3 = sequential({ errorHandler })
parent3.use('/api', child3)
parent3.lookup(req3, res3)

setImmediate(() => {
  console.log('After lookup req.url:', JSON.stringify(req3.url))
  console.log('Expected:          "/api/async-crash"')
})
