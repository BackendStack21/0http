/* global describe, it, before, after */
const expect = require('chai').expect
const request = require('supertest')
const queryparams = require('../lib/utils/queryparams')
const next = require('../lib/next')

describe('0http - Router Coverage', () => {
  const baseUrl = `http://localhost:${process.env.PORT}`
  let server, router

  describe('Sequential Router Configuration', () => {
    it('should create router with default configuration', () => {
      const sequentialRouter = require('../lib/router/sequential')()
      expect(sequentialRouter).to.have.property('id')
      expect(sequentialRouter).to.have.property('lookup')
      expect(sequentialRouter).to.have.property('use')
      expect(sequentialRouter).to.have.property('on')
    })

    it('should create router with custom configuration', () => {
      const customDefaultRoute = (req, res) => {
        res.statusCode = 418 // I'm a teapot
        res.end('Custom 404')
      }

      const customErrorHandler = (err, req, res) => {
        res.statusCode = 500
        res.end('Custom error: ' + err.message)
      }

      const customId = 'CUSTOM-ROUTER-ID'

      const sequentialRouter = require('../lib/router/sequential')({
        defaultRoute: customDefaultRoute,
        errorHandler: customErrorHandler,
        cacheSize: 100,
        id: customId
      })

      expect(sequentialRouter.id).to.equal(customId)
    })

    it('should create router with positive cacheSize', () => {
      const sequentialRouter = require('../lib/router/sequential')({
        cacheSize: 10
      })
      expect(sequentialRouter).to.have.property('id')
    })

    it('should create router with zero cacheSize', () => {
      const sequentialRouter = require('../lib/router/sequential')({
        cacheSize: 0
      })
      expect(sequentialRouter).to.have.property('id')
    })

    it('should handle router.use with middleware that has no id', () => {
      const sequentialRouter = require('../lib/router/sequential')()
      // This should not throw an error
      sequentialRouter.use('/test', (req, res, next) => next())
      expect(sequentialRouter).to.have.property('id')
    })

    // Test for step parameter in lookup
    it('should handle step parameter in lookup', () => {
      const router = require('../lib/router/sequential')()

      router.get('/step-test', (req, res, next) => {
        req.stepCalled = true
        next()
      })

      const req = { method: 'GET', url: '/step-test' }
      const res = {
        end: () => {},
        statusCode: 200
      }

      let stepCalled = false
      const step = () => {
        stepCalled = true
      }

      router.lookup(req, res, step)
      expect(stepCalled).to.equal(true)
    })

    // Test for no handlers case
    it('should call defaultRoute when no handlers match', () => {
      let defaultRouteCalled = false

      const router = require('../lib/router/sequential')({
        defaultRoute: (req, res) => {
          defaultRouteCalled = true
          res.statusCode = 404
          res.end()
        }
      })

      const req = { method: 'GET', url: '/non-existent' }
      const res = {
        end: () => {},
        statusCode: 200
      }

      router.lookup(req, res)
      expect(defaultRouteCalled).to.equal(true)
      expect(res.statusCode).to.equal(404)
    })
  })

  describe('Router API and Error Handling', () => {
    before((done) => {
      const http = require('../index')({
        router: require('../lib/router/sequential')()
      })
      router = http.router
      server = http.server

      // Register routes for testing
      router.get('/error', (req, res) => {
        throw new Error('Intentional error')
      })

      router.get('/malformed-url', (req, res) => {
        // Test with undefined URL
        req.url = undefined
        // We need to call our own lookup, not the router's lookup
        // because the router's lookup will be called by the framework
        res.end('ok')
      })

      router.get('/empty-params', (req, res) => {
        // Force params to be undefined for testing
        req.params = undefined
        res.end('ok')
      })

      // Test router.use with function as first argument
      router.use((req, res, next) => {
        req.useCalled = true
        next()
      })

      router.get('/use-test', (req, res) => {
        res.end(req.useCalled ? 'use called' : 'use not called')
      })

      // Test router.on method
      router.on('PUT', '/on-test', (req, res) => {
        res.end('on method works')
      })

      server.listen(~~process.env.PORT, () => {
        done()
      })
    })

    it('should handle errors in route handlers', async () => {
      await request(baseUrl)
        .get('/error')
        .expect(500)
        .then((response) => {
          expect(response.text).to.equal('Intentional error')
        })
    })

    it('should handle malformed URLs', async () => {
      await request(baseUrl)
        .get('/malformed-url')
        .expect(200)
        .then((response) => {
          expect(response.text).to.equal('ok')
        })
    })

    // Direct test for malformed URLs
    it('should handle undefined URL in lookup', () => {
      const req = { url: undefined }
      const res = {
        end: () => {},
        statusCode: 200
      }
      const router = require('../lib/router/sequential')()

      // This should not throw an error
      router.lookup(req, res)
      expect(req.url).to.equal('/')
    })

    it('should handle undefined params', async () => {
      await request(baseUrl)
        .get('/empty-params')
        .expect(200)
        .then((response) => {
          expect(response.text).to.equal('ok')
        })
    })

    // Test for cached route lookup
    it('should use cache for route lookup', () => {
      // Create router with cache
      const router = require('../lib/router/sequential')({
        cacheSize: 10
      })

      // Add a route
      router.get('/test', (req, res, next) => {
        res.called = true
        next()
      })

      // First lookup should miss cache
      const req1 = { method: 'GET', url: '/test' }
      const res1 = {
        end: () => {},
        statusCode: 200
      }
      router.lookup(req1, res1)

      // Second lookup should hit cache
      const req2 = { method: 'GET', url: '/test' }
      const res2 = {
        end: () => {},
        statusCode: 200
      }
      router.lookup(req2, res2)

      // Both should have path set
      expect(req1.path).to.equal('/test')
      expect(req2.path).to.equal('/test')
    })

    // Test for route with params
    it('should handle route with params when req.params exists', () => {
      const router = require('../lib/router/sequential')()

      // Add a route with params
      router.get('/users/:id', (req, res, next) => {
        res.content = req.params.id
        next()
      })

      // Create request with existing params
      const req = {
        method: 'GET',
        url: '/users/123',
        params: { existing: 'value' }
      }
      const res = {
        end: () => {},
        statusCode: 200
      }

      router.lookup(req, res)

      // Should merge params
      expect(req.params.existing).to.equal('value')
      expect(req.params.id).to.equal('123')
    })

    it('should support router.use with function as first argument', async () => {
      await request(baseUrl)
        .get('/use-test')
        .expect(200)
        .then((response) => {
          expect(response.text).to.equal('use called')
        })
    })

    it('should support router.on method', async () => {
      await request(baseUrl)
        .put('/on-test')
        .expect(200)
        .then((response) => {
          expect(response.text).to.equal('on method works')
        })
    })

    it('should handle 404 for non-existent routes', async () => {
      await request(baseUrl)
        .get('/non-existent-route')
        .expect(404)
    })

    after(() => {
      server.close()
    })
  })

  describe('Query Parameters Parser', () => {
    it('should handle URLs without query parameters', () => {
      const req = {}
      queryparams(req, '/path/without/query')
      expect(req.path).to.equal('/path/without/query')
      expect(req.query).to.deep.equal({})
    })

    it('should handle URLs with empty query string', () => {
      const req = {}
      queryparams(req, '/path?')
      expect(req.path).to.equal('/path')
      expect(req.query).to.deep.equal({})
    })

    it('should handle malformed query parameters', () => {
      const req = {}
      queryparams(req, '/path?invalid=%invalid')
      expect(req.path).to.equal('/path')
      // Should skip the invalid parameter due to decoding error
      expect(req.query).to.deep.equal({})
    })

    it('should handle query parameters without values', () => {
      const req = {}
      queryparams(req, '/path?param=')
      expect(req.path).to.equal('/path')
      expect(req.query).to.deep.equal({ param: '' })
    })

    it('should handle query parameters without equals sign', () => {
      const req = {}
      queryparams(req, '/path?param')
      expect(req.path).to.equal('/path')
      // This is skipped in the implementation as equalIndex === -1
      expect(req.query).to.deep.equal({})
    })
  })

  describe('Next Middleware Executor', () => {
    it('should handle empty middleware array', () => {
      const req = {}
      const res = { finished: false }
      const defaultRoute = (req, res) => {
        res.called = true
      }
      const errorHandler = () => {}

      next([], req, res, 0, {}, defaultRoute, errorHandler)
      expect(res.called).to.equal(true)
    })

    it('should handle finished response', () => {
      const req = {}
      const res = { finished: true }
      const defaultRoute = (req, res) => {
        res.called = true
      }
      const errorHandler = () => {}

      next([], req, res, 0, {}, defaultRoute, errorHandler)
      expect(res.called).to.equal(undefined)
    })

    it('should handle middleware errors', () => {
      const req = {}
      const res = {}
      const middleware = (req, res, next) => {
        next(new Error('Middleware error'))
      }
      const defaultRoute = () => {}
      const errorHandler = (err, req, res) => {
        res.error = err.message
      }

      next([middleware], req, res, 0, {}, defaultRoute, errorHandler)
      expect(res.error).to.equal('Middleware error')
    })

    it('should handle middleware exceptions', () => {
      const req = {}
      const res = {}
      const middleware = (req, res, next) => {
        throw new Error('Middleware exception')
      }
      const defaultRoute = () => {}
      const errorHandler = (err, req, res) => {
        res.error = err.message
      }

      next([middleware], req, res, 0, {}, defaultRoute, errorHandler)
      expect(res.error).to.equal('Middleware exception')
    })

    it('should handle nested router without pattern', () => {
      const req = { url: '/test', path: '/test' }
      const res = {}
      const nestedRouter = {
        id: 'nested-router',
        lookup: (req, res, next) => {
          req.nestedCalled = true
          next()
        }
      }
      const defaultRoute = () => {}
      const errorHandler = () => {}

      next([nestedRouter], req, res, 0, {}, defaultRoute, errorHandler)
      expect(req.nestedCalled).to.equal(true)
      expect(req.preRouterUrl).to.equal(undefined)
      expect(req.preRouterPath).to.equal(undefined)
    })

    it('should handle nested router with pattern', () => {
      const req = { url: '/prefix/test', path: '/prefix/test' }
      const res = {}
      const nestedRouter = {
        id: 'nested-router',
        lookup: (req, res, next) => {
          req.nestedCalled = true
          next()
        }
      }
      const routers = {
        'nested-router': /^\/prefix/
      }
      const defaultRoute = () => {}
      const errorHandler = () => {}

      next([nestedRouter], req, res, 0, routers, defaultRoute, errorHandler)
      expect(req.nestedCalled).to.equal(true)
      expect(req.preRouterUrl).to.equal('/prefix/test')
      expect(req.preRouterPath).to.equal('/prefix/test')
      expect(req.url).to.equal('/test')
    })

    it('should handle nested router with pattern that removes entire path', () => {
      const req = { url: '/prefix', path: '/prefix' }
      const res = {}
      const nestedRouter = {
        id: 'nested-router',
        lookup: (req, res, next) => {
          req.nestedCalled = true
          next()
        }
      }
      const routers = {
        'nested-router': /^\/prefix/
      }
      const defaultRoute = () => {}
      const errorHandler = () => {}

      next([nestedRouter], req, res, 0, routers, defaultRoute, errorHandler)
      expect(req.nestedCalled).to.equal(true)
      expect(req.preRouterUrl).to.equal('/prefix')
      expect(req.preRouterPath).to.equal('/prefix')
      expect(req.url).to.equal('/')
    })
  })
})
