/* global describe, it, before, after */
const expect = require('chai').expect
const cero = require('../index')
const sequential = require('../lib/router/sequential')

// Runs `fn` while collecting process-level failures (uncaughtException /
// unhandledRejection). Returns them so tests can assert the process survived.
async function withoutProcessCrash (fn) {
  const crashes = []
  const onUncaught = (e) => crashes.push(['uncaughtException', e])
  const onRejection = (e) => crashes.push(['unhandledRejection', e])
  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onRejection)
  try {
    await fn()
  } finally {
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onRejection)
  }
  return crashes
}

function startServer (setup) {
  const { router, server } = cero({ router: sequential() })
  setup(router)
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  })
}

function stopServer (server) {
  if (server.closeAllConnections) server.closeAllConnections()
  server.close()
}

describe('0http - security hardening (adversarial review 20260906)', () => {
  describe('F1: errors after headers sent must never crash the process', () => {
    let base, server

    before(async () => {
      ({ base, server } = await startServer((router) => {
        router.get('/boom-sync', (req, res) => {
          res.write('partial')
          throw new Error('sync after headers')
        })
        router.get('/boom-async', async (req, res) => {
          res.write('partial')
          await new Promise((resolve) => setTimeout(resolve, 10))
          throw new Error('async after headers')
        })
        router.get('/ok', (req, res) => res.end('ok'))
      }))
    })

    after(() => stopServer(server))

    it('contains sync handler errors thrown after headers were flushed', async () => {
      const crashes = await withoutProcessCrash(async () => {
        const res = await fetch(`${base}/boom-sync`)
        expect(res.status).to.equal(200)
        await res.text()
      })
      expect(crashes, 'process-level failure').to.deep.equal([])
      // The process must survive: a follow-up request must still be served.
      const ok = await fetch(`${base}/ok`)
      expect(ok.status).to.equal(200)
      expect(await ok.text()).to.equal('ok')
    })

    it('contains async handler rejections thrown after headers were flushed', async () => {
      const crashes = await withoutProcessCrash(async () => {
        const res = await fetch(`${base}/boom-async`)
        expect(res.status).to.equal(200)
        await res.text()
      })
      expect(crashes, 'process-level failure').to.deep.equal([])
      const ok = await fetch(`${base}/ok`)
      expect(ok.status).to.equal(200)
    })
  })

  describe('F1b: a throwing custom error handler must never crash the process', () => {
    let base, server

    before(async () => {
      const { router, server: srv } = cero({
        router: sequential({
          errorHandler: () => { throw new Error('broken custom handler') }
        })
      })
      router.get('/boom', () => { throw new Error('route error') })
      router.get('/ok', (req, res) => res.end('ok'))
      server = srv
      await new Promise((resolve) => server.listen(0, resolve))
      base = `http://127.0.0.1:${server.address().port}`
    })

    after(() => stopServer(server))

    it('responds a bare 500 and keeps serving', async () => {
      const crashes = await withoutProcessCrash(async () => {
        const res = await fetch(`${base}/boom`)
        expect(res.status).to.equal(500)
      })
      expect(crashes, 'process-level failure').to.deep.equal([])
      const ok = await fetch(`${base}/ok`)
      expect(ok.status).to.equal(200)
    })
  })

  describe('F1c: an async custom error handler that rejects must never crash the process', () => {
    let base, server

    before(async () => {
      const { router, server: srv } = cero({
        router: sequential({
          errorHandler: async () => { throw new Error('broken async custom handler') }
        })
      })
      router.get('/boom', () => { throw new Error('route error') })
      router.get('/ok', (req, res) => res.end('ok'))
      server = srv
      await new Promise((resolve) => server.listen(0, resolve))
      base = `http://127.0.0.1:${server.address().port}`
    })

    after(() => stopServer(server))

    it('responds a bare 500 and keeps serving', async () => {
      const crashes = await withoutProcessCrash(async () => {
        const res = await fetch(`${base}/boom`)
        expect(res.status).to.equal(500)
      })
      expect(crashes, 'process-level failure').to.deep.equal([])
      const ok = await fetch(`${base}/ok`)
      expect(ok.status).to.equal(200)
    })
  })

  describe('F2: deep nesting restores the parent URL context', () => {
    let base, server
    const seen = {}

    before(async () => {
      ({ base, server } = await startServer((router) => {
        const child = sequential({ id: 'CHILD' })
        const grand = sequential({ id: 'GRAND' })
        grand.get('/c', (req, res, next) => next())
        child.use('/b', grand, (req, res, next) => next())
        router.use('/a', child, (req, res) => {
          seen.url = req.url
          seen.path = req.path
          res.end('done')
        })
      }))
    })

    after(() => stopServer(server))

    it('parent middleware after a grandchild sees the original url/path', async () => {
      const res = await fetch(`${base}/a/b/c`)
      expect(res.status).to.equal(200)
      expect(seen.url).to.equal('/a/b/c')
      expect(seen.path).to.equal('/a/b/c')
    })
  })

  describe('F3: nested router params do not leak into the parent scope', () => {
    let base, server
    const seen = {}

    before(async () => {
      ({ base, server } = await startServer((router) => {
        const child = sequential({ id: 'CHILD' })
        const leaf = sequential({ id: 'LEAF' })
        leaf.get('/:sid', (req, res, next) => {
          seen.leafParams = { ...req.params }
          next()
        })
        child.use('/s', leaf)
        router.use('/p/:pid', child, (req, res) => {
          seen.parentParams = { ...req.params }
          res.end('done')
        })
      }))
    })

    after(() => stopServer(server))

    it('child keeps seeing inherited params (existing behavior)', async () => {
      const res = await fetch(`${base}/p/1/s/2`)
      expect(res.status).to.equal(200)
      expect(seen.leafParams).to.deep.equal({ pid: '1', sid: '2' })
    })

    it('parent middleware after the nested router sees only its own params', async () => {
      expect(seen.parentParams).to.deep.equal({ pid: '1' })
    })
  })

  describe('F4: parametrized matches are never cached', () => {
    it('param routes hit the matcher on every request; static routes stay cached', () => {
      const router = sequential({ cacheSize: 100 })
      router.get('/static', () => {})
      router.get('/user/:id', () => {})

      const findCalls = []
      const origFind = router.find.bind(router)
      router.find = (method, path) => {
        findCalls.push(path)
        return origFind(method, path)
      }

      const fakeRes = { end () {}, write () {} }
      const hit = (p) => router.lookup({ method: 'GET', url: p }, fakeRes)

      hit('/static')
      hit('/static')
      hit('/user/1')
      hit('/user/1')
      hit('/no-such-route')
      hit('/no-such-route')

      expect(findCalls.filter((p) => p === '/static')).to.have.lengthOf(1)
      expect(findCalls.filter((p) => p === '/user/1')).to.have.lengthOf(2)
      expect(findCalls.filter((p) => p === '/no-such-route')).to.have.lengthOf(2)
    })

    it('does not cache long paths matched only by global middleware', () => {
      const router = sequential({ cacheSize: 100 })
      router.use(() => {}) // global middleware matches every path (empty params)
      const findCalls = []
      const origFind = router.find.bind(router)
      router.find = (method, path) => {
        findCalls.push(path)
        return origFind(method, path)
      }
      const fakeRes = { end () {}, write () {} }
      const longPath = '/junk/' + 'x'.repeat(5000)
      router.lookup({ method: 'GET', url: longPath }, fakeRes)
      router.lookup({ method: 'GET', url: longPath }, fakeRes)
      expect(findCalls.filter((p) => p === longPath)).to.have.lengthOf(2)
    })

    it('unique param traffic does not pin memory in the cache', function () {
      if (!global.gc) return this.skip()
      global.gc()
      const before = process.memoryUsage().heapUsed

      const router = sequential()
      router.get('/user/:id', () => {})
      const fakeRes = { end () {}, write () {} }
      for (let i = 0; i < 50000; i++) {
        router.lookup({ method: 'GET', url: `/user/${i}` }, fakeRes)
      }

      global.gc()
      const delta = process.memoryUsage().heapUsed - before
      expect(delta).to.be.below(32 * 1024 * 1024)
    })
  })
})
