#!/usr/bin/env node

/**
 * Micro-benchmark for queryparams optimization testing
 */

const queryparams = require('../lib/utils/queryparams')

// Test cases that cover different scenarios
const testCases = [
  '/path',                                    // No query string
  '/path?',                                  // Empty query string  
  '/path?simple=value',                      // Single parameter
  '/path?a=1&b=2&c=3',                      // Multiple parameters
  '/path?arr=1&arr=2&arr=3',                // Array parameters
  '/path?complex=val1&simple=val2&arr=1&arr=2', // Mixed parameters
  '/path?encoded=%20%21%40%23',             // URL encoded values
  '/path?empty=&another=value',             // Empty values
  '/path?dangerous=safe&normal=value',      // Safe parameters with dangerous-sounding names
]

console.log('Micro-benchmarking queryparams performance...\n')

// Warm up
for (let i = 0; i < 1000; i++) {
  testCases.forEach(url => {
    const req = {}
    queryparams(req, url)
  })
}

// Benchmark each test case
testCases.forEach((url, index) => {
  const iterations = 100000
  const req = {}
  
  console.log(`Test ${index + 1}: ${url}`)
  
  const start = process.hrtime.bigint()
  
  for (let i = 0; i < iterations; i++) {
    // Create a fresh req object each time to avoid caching effects
    const testReq = {}
    queryparams(testReq, url)
  }
  
  const end = process.hrtime.bigint()
  const totalTime = Number(end - start)
  const avgTime = totalTime / iterations
  
  console.log(`  ${iterations.toLocaleString()} iterations`)
  console.log(`  Average: ${(avgTime / 1000).toFixed(2)} µs per operation`)
  console.log(`  Total: ${(totalTime / 1000000).toFixed(2)} ms`)
  
  // Verify the result is correct
  queryparams(req, url)
  console.log(`  Result: path="${req.path}", query keys=[${Object.keys(req.query).join(', ')}]`)
  console.log()
})

// Test security - ensure dangerous properties are filtered
console.log('Security verification:')
const securityTests = [
  '/test?__proto__=polluted',
  '/test?constructor=dangerous', 
  '/test?prototype=unsafe',
  '/test?safe=value&__proto__=attack&normal=ok'
]

securityTests.forEach(url => {
  const req = {}
  queryparams(req, url)
  console.log(`${url}:`)
  console.log(`  Query keys: [${Object.keys(req.query).join(', ')}]`)
  console.log(`  Has __proto__: ${'__proto__' in req.query}`)
  console.log(`  Has constructor: ${'constructor' in req.query}`)
  console.log(`  Prototype: ${Object.getPrototypeOf(req.query)}`)
  console.log()
})

console.log('✅ Micro-benchmark complete!')
