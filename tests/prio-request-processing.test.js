/* global describe, it */
const expect = require('chai').expect

describe('0http - Request Processing Priority', () => {
  it('should enable prioRequestsProcessing', (done) => {
    const { server } = require('../index')({
      prioRequestsProcessing: true
    })

    expect(server.prioRequestsProcessing).equals(true)
    done()
  })

  it('should disable prioRequestsProcessing', (done) => {
    const { server } = require('../index')({
      prioRequestsProcessing: false
    })

    expect(server.prioRequestsProcessing).equals(false)
    done()
  })

  it('should disable prioRequestsProcessing when server is not supported', (done) => {
    const { server } = require('../index')({
      prioRequestsProcessing: true,
      server: { on: () => {} }
    })

    expect(server.prioRequestsProcessing).equals(false)
    done()
  })
})
