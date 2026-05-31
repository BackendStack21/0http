/* global describe, it */
const expect = require('chai').expect
const request = require('supertest')

/**
 * Regression tests for two findings:
 *
 *  #1 prioRequestsProcessing default flips OFF whenever ANY config object is
 *     passed without the flag, contradicting the documented `default: true`.
 *
 *  #2 The route-match cache stores trouter's `match` object (including its
 *     `params`). On a cache hit `req.params` is assigned that object BY
 *     REFERENCE, so all requests to the same method+path share one mutable
 *     object — a non-idempotent middleware mutation bleeds into later requests.
 */
describe('0http - Regression: findings validation', () => {
  describe('#1 prioRequestsProcessing default', () => {
    it('should default prioRequestsProcessing to true when omitted but other config is provided', (done) => {
      // A real-world call: user customizes the router but does NOT mention the flag.
      const { server } = require('../index')({
        router: require('../lib/router/sequential')()
      })

      // Documented default is `true`; passing unrelated config must not flip it off.
      expect(server.prioRequestsProcessing).equals(true)
      done()
    })

    it('should still honor an explicit false', (done) => {
      const { server } = require('../index')({
        prioRequestsProcessing: false,
        router: require('../lib/router/sequential')()
      })

      expect(server.prioRequestsProcessing).equals(false)
      done()
    })
  })

  describe('#2 cached params are not shared across requests', () => {
    const baseUrl = `http://localhost:${~~process.env.PORT + 1}`
    const { router, server } = require('../index')({
      router: require('../lib/router/sequential')()
    })

    it('should start the service', (done) => {
      // Non-idempotent mutation: append a marker to req.params.id on every request.
      router.get('/item/:id', (req, res) => {
        req.params.id = req.params.id + '!'
        res.end(req.params.id)
      })

      server.listen(~~process.env.PORT + 1, () => done())
    })

    it('should not leak a mutated param into the next request to the same path', async () => {
      // First hit: 'x' -> 'x!'
      const first = await request(baseUrl).get('/item/x').expect(200)
      expect(first.text).to.equal('x!')

      // Second hit to the SAME path: must also be 'x!', NOT 'x!!'.
      const second = await request(baseUrl).get('/item/x').expect(200)
      expect(second.text).to.equal('x!')

      // Third hit, to be sure it does not keep growing.
      const third = await request(baseUrl).get('/item/x').expect(200)
      expect(third.text).to.equal('x!')
    })

    it('should stop the service', async () => {
      server.close()
    })
  })
})
