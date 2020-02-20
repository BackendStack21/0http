/* global describe, it */
const expect = require('chai').expect
const request = require('supertest')

describe('0http Web Framework - Nested Routers', () => {
  const baseUrl = 'http://localhost:' + process.env.PORT

  const { router, server } = require('../index')({
    router: require('../lib/router/sequential')()
  })

  it('should successfully register routers', (done) => {
    const router1 = require('../lib/router/sequential')()
    router1.get('/url', (req, res, next) => {
      req.body = req.url
      next()
    })

    router.use(async (req, res, next) => {
      try {
        await next()
      } catch (err) {
        return next(err)
      }
    })
    router.use('/r1', router1)
    router.use('/r1', (req, res, next) => {
      res.end(req.url + ':' + req.body)

      next()
    })

    const router2 = require('../lib/router/sequential')()
    router2.get('/url/:age', (req, res, next) => {
      req.params.age = ~~req.params.age
      res.end(JSON.stringify(req.params))
    })
    router2.get('/throw', async (req, res, next) => {
      throw new Error('nested error')
    })
    router.use('/r2/:name', router2)

    server.listen(~~process.env.PORT, err => {
      if (!err) done()
    })
  })

  it('should 404 if route handler does not exist', async () => {
    await request(baseUrl)
      .get('/r1/404')
      .expect(404)
    await request(baseUrl)
      .get('/r2/404')
      .expect(404)
  })

  it('should hit GET /url on nested router /r1', async () => {
    await request(baseUrl)
      .get('/r1/url')
      .expect(200)
      .then((response) => {
        expect(response.text).to.equal('/r1/url:/url')
      })
  })

  it('should hit GET /url/:age on nested router /r2/:name', async () => {
    await request(baseUrl)
      .get('/r2/rolando/url/33?var=value')
      .expect(200)
      .then((response) => {
        expect(JSON.parse(response.text)).to.deep.include({
          name: 'rolando',
          age: 33
        })
      })
  })

  it('should handle nested router async handler error', async () => {
    await request(baseUrl)
      .get('/r2/rolando/throw')
      .expect(500)
      .then((response) => {
        expect(response.text).to.equals('nested error')
      })
  })

  it('should successfully terminate the service', async () => {
    server.close()
  })
})
