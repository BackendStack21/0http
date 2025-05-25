#!/usr/bin/env node

/**
 * Comprehensive Performance Test Suite
 * Tests various aspects of the 0http router performance
 */

const sequential = require('../lib/router/sequential')

console.log('🚀 Running comprehensive performance tests...\n')

// Test configurations
const testConfigs = [
  { name: 'No Cache', cacheSize: 0 },
  { name: 'Small Cache (100)', cacheSize: 100 },
  { name: 'Large Cache (1000)', cacheSize: 1000 },
  { name: 'Unlimited Cache', cacheSize: -1 }
]

// Test scenarios
const scenarios = [
  {
    name: 'Simple Route',
    url: '/users/123',
    setup: (router) => router.get('/users/:id', (req, res) => res.end())
  },
  {
    name: 'Complex Route with Query',
    url: '/api/v1/users/123/posts?limit=10&offset=20&sort=date',
    setup: (router) => router.get('/api/v1/users/:id/posts', (req, res) => res.end())
  },
  {
    name: 'Not Found Route',
    url: '/nonexistent/path',
    setup: (router) => router.get('/existing', (req, res) => res.end())
  },
  {
    name: 'Multiple Parameters',
    url: '/users/123/posts/456/comments/789',
    setup: (router) => router.get('/users/:userId/posts/:postId/comments/:commentId', (req, res) => res.end())
  }
]

// Mock request/response objects
function createMockReq(url) {
  return {
    method: 'GET',
    url: url,
    headers: {}
  }
}

function createMockRes() {
  return {
    statusCode: 200,
    writeHead: () => {},
    end: () => {},
    finished: false
  }
}

// Run performance tests for each configuration
for (const config of testConfigs) {
  console.log(`📊 Testing: ${config.name}`)
  console.log('─'.repeat(50))
  
  for (const scenario of scenarios) {
    const router = sequential({ cacheSize: config.cacheSize })
    scenario.setup(router)
    
    // Warm up
    for (let i = 0; i < 1000; i++) {
      const req = createMockReq(scenario.url)
      const res = createMockRes()
      router.lookup(req, res)
    }
    
    // Benchmark
    const iterations = 50000
    const start = process.hrtime.bigint()
    
    for (let i = 0; i < iterations; i++) {
      const req = createMockReq(scenario.url)
      const res = createMockRes()
      router.lookup(req, res)
    }
    
    const end = process.hrtime.bigint()
    const totalTime = Number(end - start)
    const avgTime = totalTime / iterations
    
    console.log(`  ${scenario.name.padEnd(25)} ${(avgTime / 1000).toFixed(2).padStart(8)} µs/op`)
  }
  
  console.log()
}

// Test query parameter parsing performance
console.log('🔍 Query Parameter Parsing Performance')
console.log('─'.repeat(50))

const queryparams = require('../lib/utils/queryparams')
const queryTests = [
  '/path',
  '/path?simple=value',
  '/path?a=1&b=2&c=3&d=4&e=5',
  '/path?arr=1&arr=2&arr=3&arr=4',
  '/path?complex=val&simple=test&arr=1&arr=2&encoded=%20%21',
]

for (const url of queryTests) {
  const iterations = 100000
  const start = process.hrtime.bigint()
  
  for (let i = 0; i < iterations; i++) {
    const req = {}
    queryparams(req, url)
  }
  
  const end = process.hrtime.bigint()
  const totalTime = Number(end - start)
  const avgTime = totalTime / iterations
  
  const queryDesc = url.includes('?') ? `${url.split('?')[1].split('&').length} params` : 'no query'
  console.log(`  ${queryDesc.padEnd(15)} ${(avgTime / 1000).toFixed(2).padStart(8)} µs/op`)
}

// Memory usage test
console.log('\n💾 Memory Usage Test')
console.log('─'.repeat(50))

const router = sequential({ cacheSize: 1000 })
router.get('/users/:id', (req, res) => res.end())
router.get('/posts/:id/comments/:commentId', (req, res) => res.end())

const initialMemory = process.memoryUsage()

// Simulate traffic
for (let i = 0; i < 10000; i++) {
  const urls = [
    `/users/${i}`,
    `/posts/${i}/comments/${i * 2}`,
    `/users/${i}?query=test`,
    `/nonexistent/${i}`
  ]
  
  for (const url of urls) {
    const req = createMockReq(url)
    const res = createMockRes()
    router.lookup(req, res)
  }
}

const finalMemory = process.memoryUsage()
const memoryIncrease = {
  rss: finalMemory.rss - initialMemory.rss,
  heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
  heapTotal: finalMemory.heapTotal - initialMemory.heapTotal
}

console.log(`  RSS increase:        ${(memoryIncrease.rss / 1024 / 1024).toFixed(2)} MB`)
console.log(`  Heap used increase:  ${(memoryIncrease.heapUsed / 1024 / 1024).toFixed(2)} MB`)
console.log(`  Heap total increase: ${(memoryIncrease.heapTotal / 1024 / 1024).toFixed(2)} MB`)

console.log('\n✅ Performance testing complete!')
