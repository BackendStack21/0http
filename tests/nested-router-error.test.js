/* global describe, it */
const expect = require('chai').expect
const request = require('supertest')
const sequential = require('../lib/router/sequential')
const zero = require('../index')

describe('0http - Nested Router Error Handling', () => {
  describe('req.url restoration on nested router errors', () => {
    it('should restore req.url when a nested handler throws synchronously', (done) => {
      let capturedUrl = null
      let capturedOriginalUrl = null

      const errorHandler = (err, req, res) => {
        capturedUrl = req.url
        capturedOriginalUrl = req.originalUrl
        res.statusCode = 500
        res.end('error')
      }

      const parent = sequential({ errorHandler })
      const child = sequential()
      child.get('/crash', (req, res) => {
        throw new Error('boom')
      })
      parent.use('/api', child)

      const req = { method: 'GET', url: '/api/crash', headers: {} }
      const res = { statusCode: 200, finished: false, setHeader: () => {}, end: () => { res.finished = true } }

      parent.lookup(req, res)

      expect(capturedUrl).to.equal('/api/crash')
      expect(capturedOriginalUrl).to.equal('/api/crash')
      expect(req.url).to.equal('/api/crash')
      expect(req.preRouterUrl).to.equal(undefined)
      expect(res.statusCode).to.equal(500)
      done()
    })

    it('should restore req.url when a nested handler calls next(err)', (done) => {
      let capturedUrl = null

      const errorHandler = (err, req, res) => {
        capturedUrl = req.url
        res.statusCode = 500
        res.end('error')
      }

      const parent = sequential({ errorHandler })
      const child = sequential()
      child.get('/next-error', (req, res, next) => {
        next(new Error('next error'))
      })
      parent.use('/api', child)

      const req = { method: 'GET', url: '/api/next-error', headers: {} }
      const res = { statusCode: 200, finished: false, setHeader: () => {}, end: () => { res.finished = true } }

      parent.lookup(req, res)

      expect(capturedUrl).to.equal('/api/next-error')
      expect(req.url).to.equal('/api/next-error')
      expect(req.preRouterUrl).to.equal(undefined)
      done()
    })

    it('should restore req.url when a nested async handler rejects', (done) => {
      let capturedUrl = null

      const errorHandler = (err, req, res) => {
        capturedUrl = req.url
        res.statusCode = 500
        res.end('error')
      }

      const parent = sequential({ errorHandler })
      const child = sequential()
      child.get('/async-crash', async (req, res) => {
        throw new Error('async boom')
      })
      parent.use('/api', child)

      const req = { method: 'GET', url: '/api/async-crash', headers: {} }
      const res = { statusCode: 200, finished: false, setHeader: () => {}, end: () => { res.finished = true } }

      parent.lookup(req, res)

      setImmediate(() => {
        expect(capturedUrl).to.equal('/api/async-crash')
        expect(req.url).to.equal('/api/async-crash')
        expect(req.preRouterUrl).to.equal(undefined)
        done()
      })
    })

    it('should invoke the parent error handler, not the nested router default', (done) => {
      let parentHandlerCalled = false

      const errorHandler = (err, req, res) => {
        parentHandlerCalled = true
        res.statusCode = 500
        res.end('parent handled')
      }

      const parent = sequential({ errorHandler })
      const child = sequential() // uses default error handler
      child.get('/crash', (req, res) => {
        throw new Error('boom')
      })
      parent.use('/api', child)

      const req = { method: 'GET', url: '/api/crash', headers: {} }
      const res = { statusCode: 200, finished: false, setHeader: () => {}, end: (body) => { res._body = body; res.finished = true } }

      parent.lookup(req, res)

      expect(parentHandlerCalled).to.equal(true)
      expect(res._body).to.equal('parent handled')
      done()
    })
  })

  describe('full server integration', () => {
    it('should return parent error response for nested router errors', (done) => {
      const errorHandler = (err, req, res) => {
        res.statusCode = 500
        res.end('parent-handled')
      }

      const { router, server } = zero({
        router: sequential({ errorHandler })
      })

      const child = sequential()
      child.get('/crash', (req, res) => {
        throw new Error('boom')
      })
      router.use('/api', child)

      server.listen(0, () => {
        const port = server.address().port
        request(`http://127.0.0.1:${port}`)
          .get('/api/crash')
          .expect(500)
          .end((err, res) => {
            if (err) {
              server.close(() => done(err))
              return
            }
            expect(res.text).to.equal('parent-handled')
            server.close(done)
          })
      })
    })

    it('should not corrupt req.url in parent error handler logs', (done) => {
      const loggedUrls = []

      const errorHandler = (err, req, res) => {
        loggedUrls.push(req.url)
        res.statusCode = 500
        res.end('error')
      }

      const { router, server } = zero({
        router: sequential({ errorHandler })
      })

      const child = sequential()
      child.get('/crash', (req, res) => {
        throw new Error('boom')
      })
      router.use('/api', child)

      server.listen(0, () => {
        const port = server.address().port
        request(`http://127.0.0.1:${port}`)
          .get('/api/crash')
          .expect(500)
          .end((err) => {
            if (err) {
              server.close(() => done(err))
              return
            }
            expect(loggedUrls).to.deep.equal(['/api/crash'])
            server.close(done)
          })
      })
    })
  })
})
