#!/usr/bin/env node

/**
 * Test script to verify prototype pollution protection
 */

const sequential = require('../lib/router/sequential')

console.log('Testing prototype pollution protection...\n')

// Create a router
const router = sequential()

// Add a simple route
router.get('/test', (req, res) => {
  console.log('Query object keys:', Object.keys(req.query))
  console.log('Query object:', req.query)
  console.log('Has __proto__ property:', '__proto__' in req.query)
  console.log('Has constructor property:', 'constructor' in req.query)
  console.log('Query object prototype:', Object.getPrototypeOf(req.query))

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    query: req.query,
    hasProto: '__proto__' in req.query,
    hasConstructor: 'constructor' in req.query,
    prototype: Object.getPrototypeOf(req.query)
  }))
})

// Test various prototype pollution attempts
const testCases = [
  '/test?normal=value',
  '/test?__proto__[polluted]=true',
  '/test?constructor[prototype][polluted]=true',
  '/test?prototype[polluted]=true',
  '/test?__proto__.polluted=true',
  '/test?constructor.prototype.polluted=true'
]

console.log('Before tests - Object.prototype.polluted:', Object.prototype.polluted)

// Mock request/response objects for testing
function createMockReq (url) {
  return {
    method: 'GET',
    url,
    headers: {}
  }
}

function createMockRes () {
  let data = ''
  return {
    statusCode: 200,
    writeHead: () => {},
    end: (chunk) => { data += chunk },
    finished: false,
    _getData: () => data
  }
}

// Test each case
testCases.forEach((testUrl, index) => {
  console.log(`\n--- Test ${index + 1}: ${testUrl} ---`)

  const req = createMockReq(testUrl)
  const res = createMockRes()

  try {
    router.lookup(req, res)
    const responseData = JSON.parse(res._getData())
    console.log('Response:', responseData)
  } catch (error) {
    console.error('Error:', error.message)
  }
})

console.log('\nAfter tests - Object.prototype.polluted:', Object.prototype.polluted)

if (Object.prototype.polluted) {
  console.log('\n❌ VULNERABILITY: Prototype pollution detected!')
  process.exit(1)
} else {
  console.log('\n✅ SUCCESS: No prototype pollution detected!')
  process.exit(0)
}
