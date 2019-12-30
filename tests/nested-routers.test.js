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

    const router2 = require('../lib/router/sequential')()
    router2.get('/url', (req, res, next) => {
      req.body = req.url
      next()
    })
    router.use('/r2', router2)
    router.use('/r1', router1)

    router.use('/*', (req, res, next) => {
      res.end(req.url + ':' + req.body)

      next()
    })

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

  it('should hit GET /url on nested routers', async () => {
    await request(baseUrl)
      .get('/r1/url')
      .expect(200)
      .then((response) => {
        expect(response.text).to.equal('/r1/url:/url')
      })

    await request(baseUrl)
      .get('/r2/url?var=value')
      .expect(200)
      .then((response) => {
        expect(response.text).to.equal('/r2/url?var=value:/url?var=value')
      })
  })

  it('should successfully terminate the service', async () => {
    server.close()
  })
})
