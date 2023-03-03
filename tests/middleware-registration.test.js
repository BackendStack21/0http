/* global describe, it */
const expect = require('chai').expect
const request = require('supertest')

describe('0http - Middlewares Registration', () => {
  const baseUrl = `http://localhost:${process.env.PORT}`

  const { router, server } = require('../index')({
    router: require('../lib/router/sequential')()
  })

  const m0 = (req, res, next) => {
    res.body = []

    return next()
  }

  const m1 = (req, res, next) => {
    res.body.push('m1')

    return next()
  }

  const m2 = (req, res, next) => {
    res.body.push('m2')

    return next()
  }

  const m3 = (req, res, next) => {
    res.body.push('m3')

    return next()
  }

  it('should successfully register middlewares', (done) => {
    router.use(m0, m1)
    router.use('/v1', m2, m3)

    router.get('/v1/hello', (req, res, next) => {
      res.end(JSON.stringify(res.body))
    })

    server.listen(~~process.env.PORT, (err) => {
      if (!err) done()
    })
  })

  it('should hit middlewares', async () => {
    await request(baseUrl)
      .get('/v1/hello')
      .expect(200)
      .then((response) => {
        const payload = JSON.parse(response.text)

        expect(payload[0]).to.equal('m1')
        expect(payload[1]).to.equal('m2')
        expect(payload[2]).to.equal('m3')
      })
  })

  it('should successfully terminate the service', async () => {
    server.close()
  })
})
