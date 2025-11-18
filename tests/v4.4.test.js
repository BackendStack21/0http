/* global describe, it, before, after */
const cero = require('../index')
const request = require('supertest')

describe('v4.4 Improvements', () => {
  describe('Security: Default Error Handler', () => {
    let originalEnv

    before(() => {
      originalEnv = process.env.NODE_ENV
    })

    after(() => {
      process.env.NODE_ENV = originalEnv
    })

    it('should hide error message in production', async () => {
      process.env.NODE_ENV = 'production'
      const { router, server } = cero()

      router.get('/error', (req, res, next) => {
        next(new Error('Sensitive Info'))
      })

      await request(server)
        .get('/error')
        .expect(500)
        .expect('Internal Server Error')
    })

    it('should show error message in development', async () => {
      process.env.NODE_ENV = 'development'
      const { router, server } = cero()

      router.get('/error', (req, res, next) => {
        next(new Error('Sensitive Info'))
      })

      await request(server)
        .get('/error')
        .expect(500)
        .expect('Sensitive Info')
    })
  })

  describe('Performance: Static Nested Routes', () => {
    it('should handle static nested routes correctly', async () => {
      const { router, server } = cero()
      const nestedRouter = cero().router

      nestedRouter.get('/world', (req, res) => {
        res.end('Hello World')
      })

      router.use('/hello', nestedRouter)

      await request(server)
        .get('/hello/world')
        .expect(200)
        .expect('Hello World')
    })

    it('should handle deep static nested routes', async () => {
      const { router, server } = cero()
      const r1 = cero().router
      const r2 = cero().router

      r2.get('/end', (req, res) => {
        res.end('End')
      })

      r1.use('/level2', r2)
      router.use('/level1', r1)

      await request(server)
        .get('/level1/level2/end')
        .expect(200)
        .expect('End')
    })

    it('should still handle regex nested routes', async () => {
      const { router, server } = cero()
      const nestedRouter = cero().router

      nestedRouter.get('/world', (req, res) => {
        res.end('Hello World')
      })

      router.use('/hello/:name', nestedRouter)

      await request(server)
        .get('/hello/john/world')
        .expect(200)
        .expect('Hello World')
    })
  })
})
