#!/usr/bin/env node

/**
 * Advanced test for prototype pollution protection including edge cases
 */

const sequential = require('../lib/router/sequential')

console.log('Advanced prototype pollution protection test...\n')

// Test direct property access attempts
const testCases = [
  // Standard URLSearchParams parsing might decode these differently
  '/test?__proto__=polluted',
  '/test?constructor=polluted',
  '/test?prototype=polluted',

  // URL encoded versions
  '/test?%5F%5Fproto%5F%5F=polluted', // __proto__
  '/test?constructor%2Eprototype=polluted', // constructor.prototype

  // Multiple same-name parameters (should create arrays)
  '/test?__proto__=value1&__proto__=value2',
  '/test?constructor=value1&constructor=value2',

  // Mixed dangerous and safe parameters
  '/test?safe=value&__proto__=polluted&another=safe'
]

console.log('Before tests:')
console.log('- Object.prototype.polluted:', Object.prototype.polluted)
console.log('- Object.prototype.testProp:', Object.prototype.testProp)

// Mock request/response objects
function createMockReq (url) {
  return {
    method: 'GET',
    url,
    headers: {}
  }
}

function createMockRes () {
  return {
    statusCode: 200,
    writeHead: () => {},
    end: () => {},
    finished: false
  }
}

const router = sequential()

// Test each case
testCases.forEach((testUrl, index) => {
  console.log(`\n--- Test ${index + 1}: ${testUrl} ---`)

  const req = createMockReq(testUrl)
  const res = createMockRes()

  // Mock a simple route handler
  router.get('/test', (req, res) => {
    console.log('Query keys:', Object.keys(req.query))
    console.log('Query values:', req.query)
    console.log('Prototype:', Object.getPrototypeOf(req.query))
    res.end()
  })

  try {
    router.lookup(req, res)
  } catch (error) {
    console.error('Error during lookup:', error.message)
  }
})

console.log('\nAfter tests:')
console.log('- Object.prototype.polluted:', Object.prototype.polluted)
console.log('- Object.prototype.testProp:', Object.prototype.testProp)

// Test if we can access dangerous properties through any means
try {
  const testObj = {}
  /* eslint-disable no-proto */
  console.log('- testObj.__proto__:', testObj.__proto__)
  console.log('- testObj.constructor:', testObj.constructor)
} catch (e) {
  console.log('- Error accessing prototype properties:', e.message)
}

// Final verification
const hasPollution = Object.prototype.polluted || Object.prototype.testProp
if (hasPollution) {
  console.log('\n❌ VULNERABILITY: Prototype pollution detected!')
  process.exit(1)
} else {
  console.log('\n✅ SUCCESS: Advanced prototype pollution protection working!')
  process.exit(0)
}
