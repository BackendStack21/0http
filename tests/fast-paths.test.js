/* global describe, it */
const expect = require('chai').expect
const { Trouter } = require('trouter')
const sequential = require('../lib/router/sequential')
const queryparams = require('../lib/utils/queryparams')

const fakeRes = () => ({ end () {}, write () {}, setHeader () {} })

// Reference matcher: regexparam patterns consumed by the stock Trouter#find.
const referenceFind = (router, method, url) => Trouter.prototype.find.call(router, method, url)

describe('0http - hot-path fast paths (perf pass)', () => {
  describe('queryparams: structural fast path vs WHATWG decoder', () => {
    it('decodes percent-escapes and plus signs through the decoding path', () => {
      const req = {}
      queryparams(req, '/p?na%6De=J%C3%BCrgen+Doe&q=a+b&x=%zz&y=100%25')
      expect(req.query).to.deep.equal({ name: 'Jürgen Doe', q: 'a b', x: '%zz', y: '100%' })
    })

    it('blocks dangerous names even when percent-encoded', () => {
      const req = {}
      queryparams(req, '/p?%5F%5Fproto%5F%5F=x&constructor%2Eprototype=y&ok=1')
      expect(Object.keys(req.query)).to.deep.equal(['ok'])
      expect(({}).polluted).to.equal(undefined)
    })

    it('parses segment-heavy strings in linear time (no rescans for "=")', () => {
      const search = 'a&'.repeat(200000) + '='
      const req = {}
      const started = process.hrtime.bigint()
      queryparams(req, '/p?' + search)
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      expect(req.query).to.deep.equal({ a: Array(200000).fill(''), '': '' })
      expect(ms).to.be.below(500) // quadratic version needed seconds here
    })

    it('matches URLSearchParams exactly on structural edge cases', () => {
      const cases = [
        'a', 'a=', '=a', '=', '&', '&&', 'a&&b', 'a=1&', '&a=1', 'a=b=c', 'a=1&a=2&a=3',
        '?a=1', '??a=1', 'a?=1', 'a=?', 'a#b=c', 'a[]=1&a[]=2', 'a[]=1&a=2', 'a..b=1', 'a[b]=1',
        'proto=1', 'a.proto.b=2', 'é=ü', '😀=😀', 'x=\ud800', '\udc00=1',
        'a=1+2', 'a%=1', 'a=%', 'a=%E2%82%AC', '%41=%42'
      ]
      for (const search of cases) {
        const req = {}
        queryparams(req, '/p?' + search)
        const expected = Object.create(null)
        for (const [name, value] of new URLSearchParams(search.replace(/\[\]=/g, '=')).entries()) {
          if (name.split(/[.[\]]+/).some(s => ['__proto__', 'constructor', 'prototype'].includes(s))) continue
          if (expected[name] === undefined) expected[name] = value
          else if (Array.isArray(expected[name])) expected[name].push(value)
          else expected[name] = [expected[name], value]
        }
        expect(req.query, JSON.stringify(search)).to.deep.equal(expected)
        expect(Object.getPrototypeOf(req.query)).to.equal(null)
      }
    })
  })

  describe('find: length prefilters never reject a URL the pattern accepts', () => {
    const cases = [
      ['/static', ['/static', '/static/', '/STATIC', '/statics', '/stati', '/', '']],
      ['/', ['/', '', '/x']],
      ['/file.json', ['/file.json', '/filexjson', '/file.jsonx', '/file.json/']],
      ['/a+b', ['/ab', '/aab', '/aaab', '/a+b', '/b']],
      ['/(x)', ['/x', '/(x)', '/xx']],
      ['/x|y', ['/x', 'y', '/x|y', '/y']],
      ['/users/:id', ['/users/1', '/users/', '/users', '/users/1/2', '/users/1/']],
      ['/users/:id?', ['/users', '/users/', '/users/1', '/users/1/']],
      ['/files/*', ['/files', '/files/', '/files/a/b', '/file']],
      ['/files/*?', ['/files', '/files/', '/files/a/b']],
      ['/img/:name.png', ['/img/a.png', '/img/.png', '/img/a.jpg', '/img/a.png/', '/img/axpng']],
      ['/img/:name.png?', ['/img/a.png', '/img/a', '/img/a.pn']],
      ['/a/:b/c/:d', ['/a/1/c/2', '/a/1/c', '/a//c/2', '/a/1/c/2/']]
    ]

    for (const loose of [false, true]) {
      it(`${loose ? 'use' : 'get'}: agrees with Trouter#find on every case`, () => {
        for (const [route, urls] of cases) {
          const router = sequential({ cacheSize: 0 })
          const handler = () => {}
          if (loose) router.use(route, handler); else router.get(route, handler)
          for (const url of urls) {
            const ours = router.find('GET', url)
            const ref = referenceFind(router, 'GET', url)
            expect(ours.handlers, `${route} ${url}`).to.deep.equal(ref.handlers)
            expect(ours.params, `${route} ${url}`).to.deep.equal(ref.params)
          }
        }
      })
    }

    it('keeps HEAD → GET fallback, method filtering and registration order', () => {
      const router = sequential({ cacheSize: 0 })
      const a = () => 'a'; const b = () => 'b'; const c = () => 'c'; const d = () => 'd'
      router.use(a).get('/x', b, c).post('/x', d)
      expect(router.find('HEAD', '/x').handlers).to.deep.equal([a, b, c])
      expect(router.find('POST', '/x').handlers).to.deep.equal([a, d])
      expect(router.find('PUT', '/x').handlers).to.deep.equal([a])
      expect(router.find('__proto__', '/x').handlers).to.deep.equal([a])
    })

    it('captures named groups from RegExp routes and shares no params object', () => {
      const router = sequential({ cacheSize: 0 })
      router.get(/^\/re\/(?<slug>[^/]+)$/, () => {})
      router.get('/plain', () => {})
      expect(router.find('GET', '/re/abc').params).to.deep.equal({ slug: 'abc' })
      const first = router.find('GET', '/plain').params
      expect(first).to.deep.equal({})
      expect(Object.isFrozen(first)).to.equal(true)
      expect(router.find('GET', '/plain').params).to.equal(first)
    })

    it('gives every request its own mutable req.params', () => {
      const router = sequential()
      const seen = []
      router.get('/plain', (req, res) => { req.params.touched = true; seen.push(req.params); res.end() })
      router.lookup({ method: 'GET', url: '/plain' }, fakeRes())
      router.lookup({ method: 'GET', url: '/plain' }, fakeRes())
      expect(seen[0]).to.not.equal(seen[1])
      expect(Object.keys(seen[1])).to.deep.equal(['touched'])
    })

    it('normalizes g/y RegExp flags on all() and on every method shortcut', () => {
      const router = sequential({ cacheSize: 0 })
      router.all(/^\/g$/g, () => {})
      router.trace(/^\/y$/y, () => {})
      for (let i = 0; i < 5; i++) {
        expect(router.find('GET', '/g').handlers).to.have.lengthOf(1)
        expect(router.find('TRACE', '/y').handlers).to.have.lengthOf(1)
      }
      expect(router.routes.every(r => !r.pattern.global && !r.pattern.sticky)).to.equal(true)
    })

    it('normalizes g/y flags on use() prefixes too', () => {
      const router = sequential({ cacheSize: 0 })
      router.use(/^\/g/g, () => {})
      for (let i = 0; i < 4; i++) expect(router.find('GET', '/g/x').handlers).to.have.lengthOf(1)
    })

    it('keeps the query string out of a nested router path (dynamic prefix)', () => {
      const child = sequential({ id: 'c' })
      const seen = []
      child.get('/admin', (req, res) => { seen.push('ADMIN'); res.end() })
      child.use((req, res) => { seen.push(req.url); res.end() })
      const parent = sequential().use('/api/:tenant', child)
      parent.lookup({ method: 'GET', url: '/api/acme?x=/admin' }, { end () {} })
      parent.lookup({ method: 'GET', url: '/api/acme/admin' }, { end () {} })
      expect(seen).to.deep.equal(['/?x=/admin', 'ADMIN'])
    })

    it('mounts one router at two prefixes and contains a throwing defaultRoute', () => {
      const child = sequential({ id: 'twice' })
      const seen = []
      child.get('/x', (req, res) => { seen.push(req.url); res.end() })
      const parent = sequential().use('/legacy', child).use('/v1', child)
      parent.lookup({ method: 'GET', url: '/v1/x' }, { end () {} })
      parent.lookup({ method: 'GET', url: '/legacy/x' }, { end () {} })
      expect(seen).to.deep.equal(['/x', '/x'])
      const bodies = []
      const r = sequential({ defaultRoute: () => { throw new Error('d404') }, errorHandler: (e, req, res) => res.end('EH:' + e.message) })
      r.lookup({ method: 'GET', url: '/nothing' }, { statusCode: 200, headersSent: false, setHeader () {}, end (b) { bodies.push(b) } })
      expect(bodies).to.deep.equal(['EH:d404'])
    })

    it('falls back to the regex for routes registered behind the wrapper', () => {
      const router = sequential({ cacheSize: 0 })
      Trouter.prototype.add.call(router, 'GET', '/raw', () => {})
      expect(router.routes[0].min).to.equal(undefined)
      expect(router.find('GET', '/raw').handlers).to.have.lengthOf(1)
      expect(router.find('GET', '/raw/').handlers).to.have.lengthOf(1)
      expect(router.find('GET', '/rawx').handlers).to.have.lengthOf(0)
    })
  })

  describe('lookup: error handler bubbling through a manually driven child', () => {
    it('uses the parent errorHandler when middleware calls child.lookup(req, res, next)', async () => {
      const parent = sequential({ errorHandler: (err, req, res) => res.end('PARENT:' + err.message) })
      const child = sequential({ errorHandler: (err, req, res) => res.end('CHILD:' + err.message) })
      child.get('/boom', () => { throw new Error('sync') })
      child.get('/async', async () => { throw new Error('async') })
      parent.use((req, res, next) => child.lookup(req, res, next))
      const bodies = []
      const mk = () => ({ statusCode: 200, headersSent: false, setHeader () {}, end (b) { bodies.push(b) } })
      parent.lookup({ method: 'GET', url: '/boom' }, mk())
      await parent.lookup({ method: 'GET', url: '/async' }, mk())
      expect(bodies).to.deep.equal(['PARENT:sync', 'PARENT:async'])
    })
  })

  describe('lookup: top-level fast path keeps error semantics', () => {
    it('routes sync and async errors to the configured errorHandler', async () => {
      const errors = []
      const router = sequential({ errorHandler: (err, req, res) => { errors.push(err.message); res.end() } })
      router.get('/sync', () => { throw new Error('sync') })
      router.get('/async', async () => { throw new Error('async') })
      router.get('/next', (req, res, next) => next(new Error('next')))
      router.lookup({ method: 'GET', url: '/sync' }, fakeRes())
      await router.lookup({ method: 'GET', url: '/async' }, fakeRes())
      router.lookup({ method: 'GET', url: '/next' }, fakeRes())
      expect(errors).to.deep.equal(['sync', 'async', 'next'])
    })

    it('survives a throwing errorHandler at the top level', () => {
      const router = sequential({ errorHandler: () => { throw new Error('boom') } })
      router.get('/x', () => { throw new Error('x') })
      const res = { headersSent: false, statusCode: 0, body: '', setHeader () {}, end (b) { this.body = b } }
      expect(() => router.lookup({ method: 'GET', url: '/x' }, res)).to.not.throw()
      expect(res.statusCode).to.equal(500)
      expect(res.body).to.equal('Internal Server Error')
    })
  })
})
