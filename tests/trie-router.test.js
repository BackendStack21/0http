/* global describe, it, before, after */
const expect = require('chai').expect
const request = require('supertest')
const cero = require('../index')
const trie = require('../lib/router/trie')

const fakeRes = () => ({ statusCode: 200, headersSent: false, end () {}, write () {}, setHeader () {} })
const names = (router, method, url) => router.find(method, url).handlers.map(h => h.n)
const h = (n) => { const f = (req, res, next) => next(); f.n = n; return f }

describe('0http - trie router', () => {
  describe('matching semantics', () => {
    it('chains every matching route and middleware in registration order', () => {
      const r = trie()
      r.use(h('mw')).get('/users/:id', h('param')).get('/users/me', h('me')).use('/users', h('users-mw')).all('/users/me', h('all'))
      expect(names(r, 'GET', '/users/me')).to.deep.equal(['mw', 'param', 'me', 'users-mw', 'all'])
      expect(names(r, 'GET', '/users/42')).to.deep.equal(['mw', 'param', 'users-mw'])
      expect(names(r, 'POST', '/users/me')).to.deep.equal(['mw', 'users-mw', 'all'])
      expect(names(r, 'GET', '/users')).to.deep.equal(['mw', 'users-mw'])
      expect(names(r, 'GET', '/usersx')).to.deep.equal(['mw'])
    })

    it('falls back from HEAD to GET handlers', () => {
      const r = trie().get('/x', h('get')).post('/x', h('post'))
      expect(names(r, 'HEAD', '/x')).to.deep.equal(['get'])
      expect(names(r, 'PUT', '/x')).to.deep.equal([])
    })

    it('captures params, optional params, suffix params and wildcards', () => {
      const r = trie()
      r.get('/a/:x/b/:y', h(1)).get('/opt/:a?', h(2)).get('/img/:name.png', h(3)).get('/img/:name.tar.gz', h(4)).get('/files/*', h(5))
      expect(r.find('GET', '/a/1/b/2').params).to.deep.equal({ x: '1', y: '2' })
      expect(r.find('GET', '/opt').params).to.deep.equal({})
      expect(r.find('GET', '/opt/v').params).to.deep.equal({ a: 'v' })
      expect(r.find('GET', '/img/pic.png').params).to.deep.equal({ name: 'pic' })
      expect(r.find('GET', '/img/a.b.png').params).to.deep.equal({ name: 'a.b' })
      expect(r.find('GET', '/img/x.tar.gz').params).to.deep.equal({ name: 'x' })
      expect(names(r, 'GET', '/img/.png')).to.deep.equal([])
      expect(names(r, 'GET', '/img/pic.jpg')).to.deep.equal([])
      expect(r.find('GET', '/files/a/b/c').params).to.deep.equal({ '*': 'a/b/c' })
      expect(r.find('GET', '/files/a/b/').params).to.deep.equal({ '*': 'a/b/' })
      expect(r.find('GET', '/files/').params).to.deep.equal({ '*': '' })
      expect(r.find('GET', '/files').params).to.deep.equal({ '*': '' })
    })

    it('matches the root route for "/" and for an empty url', () => {
      const r = trie().get('/', h('root'))
      expect(names(r, 'GET', '/')).to.deep.equal(['root'])
      expect(names(r, 'GET', '')).to.deep.equal(['root'])
      expect(names(r, 'GET', '/x')).to.deep.equal([])
    })

    it('treats static segments literally (no regex meaning)', () => {
      const r = trie().get('/a+b', h(1)).get('/file.json', h(2)).get('/(x)', h(3))
      expect(names(r, 'GET', '/a+b')).to.deep.equal([1])
      expect(names(r, 'GET', '/aab')).to.deep.equal([])
      expect(names(r, 'GET', '/file.json')).to.deep.equal([2])
      expect(names(r, 'GET', '/filexjson')).to.deep.equal([])
      expect(names(r, 'GET', '/(x)')).to.deep.equal([3])
    })

    it('is case-sensitive by default and case-insensitive on request', () => {
      const r = trie().get('/Users/:id', h(1))
      expect(names(r, 'GET', '/Users/AbC')).to.deep.equal([1])
      expect(names(r, 'GET', '/users/AbC')).to.deep.equal([])
      const ci = trie({ caseSensitive: false }).get('/Users/:id', h(1)).get('/img/:n.PNG', h(2))
      expect(names(ci, 'GET', '/USERS/AbC')).to.deep.equal([1])
      expect(ci.find('GET', '/USERS/AbC').params).to.deep.equal({ id: 'AbC' })
      expect(ci.find('GET', '/IMG/Pic.png').params).to.deep.equal({ n: 'Pic' })
      // ASCII-only folding: non-ASCII letters are neither folded nor altered.
      expect(ci.find('GET', '/users/\u0130x').params.id).to.equal('\u0130x')
      expect(names(ci, 'GET', '/\u212Aeys')).to.deep.equal([]) // Kelvin sign is not 'k'
    })

    it('matches nothing for a path without a leading slash', () => {
      const r = trie().use(h('mw')).get('/x', h(1)).get('/:p', h(2)).options('/:p', h(3))
      expect(names(r, 'GET', 'x')).to.deep.equal([])
      expect(names(r, 'OPTIONS', '*')).to.deep.equal([])
      expect(names(r, 'GET', '')).to.deep.equal(['mw'])
    })

    it('runs a route with optional params exactly once, preferring present params', () => {
      const r = trie()
      r.use('/a/:b?', h('mw')).get('/s/:category?/:page?', h('s')).get('/:a?/*', h('w')).get('/:x?/:y?/:z?', h('xyz'))
      expect(names(r, 'GET', '/a/x/y')).to.deep.equal(['mw', 'w', 'xyz'])
      expect(r.find('GET', '/a/x/y').params).to.deep.equal({ b: 'x', a: 'a', '*': 'x/y', x: 'a', y: 'x', z: 'y' })
      const one = trie().get('/s/:category?/:page?', h('s'))
      expect(names(one, 'GET', '/s/books')).to.deep.equal(['s'])
      expect(one.find('GET', '/s/books').params).to.deep.equal({ category: 'books' })
      expect(one.find('GET', '/s').params).to.deep.equal({})
      const sixteen = trie().get('/' + Array.from({ length: 16 }, (_, i) => `:p${i}?`).join('/'), h('p'))
      expect(names(sixteen, 'GET', '/a/b')).to.deep.equal(['p'])
      expect(sixteen.find('GET', '/a/b').params).to.deep.equal({ p0: 'a', p1: 'b' })
      const child = trie({ id: 'c' })
      const seen = []
      child.use((req, res, next) => { seen.push(req.url); next() })
      const parent = trie().use('/m/:v?', child)
      parent.lookup({ method: 'GET', url: '/m/1/z' }, fakeRes())
      expect(seen).to.deep.equal(['/z'])
    })

    it('rejects a non-trailing "*" and a "?" that is not last in a param segment', () => {
      expect(() => trie().get('/a/*/b', h(1))).to.throw(TypeError)
      expect(() => trie().get('/i/:name?.png', h(1))).to.throw(TypeError)
      const r = trie().get('/i/:name.png?', h(1))
      expect(r.find('GET', '/i/x.png').params).to.deep.equal({ name: 'x' })
      expect(names(r, 'GET', '/i')).to.deep.equal([1])
    })

    it('registers thousands of routes in linear time', () => {
      const r = trie()
      const started = process.hrtime.bigint()
      for (let i = 0; i < 10000; i++) r.get(`/r/${i}`, h(i))
      expect(Number(process.hrtime.bigint() - started) / 1e6).to.be.below(1000)
      expect(names(r, 'GET', '/r/9999')).to.deep.equal([9999])
    })

    it('ignores a trailing slash by default and honours ignoreTrailingSlash: false', () => {
      const r = trie().get('/a', h(1)).get('/b/:id', h(2))
      expect(names(r, 'GET', '/a/')).to.deep.equal([1])
      expect(names(r, 'GET', '/b/1/')).to.deep.equal([2])
      const strict = trie({ ignoreTrailingSlash: false }).get('/a', h(1)).use('/p', h(2)).get('/w/*', h(3)).get('/dir/', h(4)).get('/', h(5))
      expect(names(strict, 'GET', '/a')).to.deep.equal([1])
      expect(names(strict, 'GET', '/a/')).to.deep.equal([])
      expect(names(strict, 'GET', '/p/')).to.deep.equal([2])
      expect(strict.find('GET', '/w/').params).to.deep.equal({ '*': '' })
      expect(names(strict, 'GET', '/dir/')).to.deep.equal([4])
      expect(names(strict, 'GET', '/dir')).to.deep.equal([])
      expect(names(strict, 'GET', '/')).to.deep.equal([5])
      // the static table honours the registered form in strict mode
      const sres = { end () {}, statusCode: 200 }
      strict.lookup({ method: 'GET', url: '/dir' }, sres)
      expect(sres.statusCode).to.equal(404)
      const hits = []
      strict.get('/dir/', (req, res) => { hits.push(req.path); res.end() })
      strict.lookup({ method: 'GET', url: '/dir/' }, { end () {}, statusCode: 200 })
      expect(hits).to.deep.equal(['/dir/'])
    })

    it('strips a RegExp mount prefix and supports one router mounted at two prefixes', () => {
      const child = trie({ id: 'c' })
      const seen = []
      child.get('/x', (req, res) => { seen.push(req.url); res.end() })
      const r = trie().use(/^\/re/, child)
      r.lookup({ method: 'GET', url: '/re/x?q=1' }, fakeRes())
      const twice = trie({ id: 't' }).get('/x', (req, res) => { seen.push(req.url); res.end() })
      const parent = trie().use('/legacy-api', twice).use('/v1', twice)
      parent.lookup({ method: 'GET', url: '/v1/x' }, fakeRes())
      parent.lookup({ method: 'GET', url: '/legacy-api/x' }, fakeRes())
      expect(seen).to.deep.equal(['/x?q=1', '/x', '/x'])
    })

    it('does not share request-specific captures through the static table in case-insensitive mode', () => {
      const ci = trie({ caseSensitive: false }).get('/users/me', h('me')).get('/users/:id', h('id'))
      const seen = []
      ci.get('/users/me', (req, res) => { seen.push(req.params.id); res.end() })
      for (const u of ['/users/ME', '/users/me', '/users/Me']) ci.lookup({ method: 'GET', url: u }, fakeRes())
      expect(seen).to.deep.equal(['ME', 'me', 'Me'])
    })

    it('supports RegExp routes with named groups and normalizes g/y flags', () => {
      const r = trie().get(/^\/re\/(?<slug>[^/]+)$/g, h(1)).all(/^\/any/y, h(2))
      for (let i = 0; i < 3; i++) {
        expect(r.find('GET', '/re/abc').params).to.deep.equal({ slug: 'abc' })
        expect(names(r, 'POST', '/anything')).to.deep.equal([2])
      }
      expect(r.routes.every(x => !x.pattern.global && !x.pattern.sticky)).to.equal(true)
    })

    it('ignores empty route segments and rejects non-string patterns', () => {
      const r = trie().get('/a//b/', h(1))
      expect(names(r, 'GET', '/a/b')).to.deep.equal([1])
      expect(() => r.get(42, h(2))).to.throw(TypeError)
    })

    it('never recurses deeper than the registered routes on long paths', () => {
      const r = trie().use(h('mw')).get('/a/:b/c', h(1))
      const deep = '/a' + '/x'.repeat(20000)
      expect(names(r, 'GET', deep)).to.deep.equal(['mw'])
      expect(names(r, 'GET', '/'.repeat(20000))).to.deep.equal(['mw'])
    })
  })

  describe('params safety', () => {
    it('gives every request a fresh params object without Object.prototype', () => {
      const r = trie()
      const seen = []
      r.get('/u/:id', (req, res) => { seen.push(req.params); req.params.extra = 1; res.end() })
      r.lookup({ method: 'GET', url: '/u/1' }, fakeRes())
      r.lookup({ method: 'GET', url: '/u/1' }, fakeRes())
      expect(seen[0]).to.not.equal(seen[1])
      expect(seen[1].extra).to.equal(1)
      expect(Object.keys(seen[1])).to.deep.equal(['id', 'extra'])
      expect('constructor' in seen[1]).to.equal(false)
      expect(Object.getPrototypeOf(Object.getPrototypeOf(seen[1]))).to.equal(null)
    })

    it('cannot pollute Object.prototype through a __proto__ route param', () => {
      const r = trie().get('/p/:__proto__', (req, res) => res.end())
      r.lookup({ method: 'GET', url: '/p/polluted' }, fakeRes())
      expect(({}).polluted).to.equal(undefined)
    })

    it('merges inherited params without mutating the parent object', () => {
      const r = trie().get('/u/:id', (req, res) => { res.content = req.params; res.end() })
      const parent = { parent: 'p' }
      const res = fakeRes()
      r.lookup({ method: 'GET', url: '/u/9', params: parent }, res)
      expect(res.content).to.deep.equal({ parent: 'p', id: '9' })
      expect(res.content).to.not.equal(parent)
      expect(parent).to.deep.equal({ parent: 'p' })
    })
  })

  describe('static table', () => {
    it('is compiled on demand and invalidated when routes change', () => {
      const r = trie().get('/s', h('s'))
      expect(names(r, 'GET', '/s')).to.deep.equal(['s'])
      const seen = []
      const probe = (req, res) => { seen.push(names(r, 'GET', req.path)); res.end() }
      r.get('/s', probe)
      r.lookup({ method: 'GET', url: '/s' }, fakeRes())
      r.use(h('late'))
      r.lookup({ method: 'GET', url: '/s' }, fakeRes())
      expect(seen[0]).to.deep.equal(['s', undefined])
      expect(seen[1]).to.deep.equal(['s', undefined, 'late'])
    })

    it('does not grow with unknown paths or unknown method tokens', function () {
      if (!global.gc) return this.skip()
      const r = trie().use((req, res) => res.end()).get('/static', (req, res) => res.end())
      global.gc()
      const before = process.memoryUsage().heapUsed
      for (let i = 0; i < 50000; i++) {
        r.lookup({ method: 'GET', url: `/junk/${i}/` + 'x'.repeat(200) }, fakeRes())
        r.lookup({ method: 'M' + i, url: '/static' }, fakeRes())
      }
      global.gc()
      expect(process.memoryUsage().heapUsed - before).to.be.below(8 * 1024 * 1024)
    })
  })

  describe('end to end with nested routers and errors', () => {
    let server, base
    const log = []
    before((done) => {
      const app = cero({ router: trie({ errorHandler: (err, req, res) => { res.statusCode = 500; res.end('handled:' + err.message) } }) })
      const { router } = app
      router.use((req, res, next) => { log.push('pre ' + req.url); return next() })
      router.get('/hello/:name', (req, res) => res.end(`hi ${req.params.name} ${JSON.stringify(req.query)}`))
      router.get('/sync', () => { throw new Error('sync') })
      router.get('/async', async () => { throw new Error('async') })
      router.get('/next', (req, res, next) => next(new Error('next')))
      router.get('/late', (req, res) => { res.write('partial'); throw new Error('late') })

      const api = trie({ id: 'api' })
      const v1 = trie({ id: 'v1' })
      v1.get('/', (req, res) => res.end(JSON.stringify({ url: req.url, params: req.params })))
      v1.get('/items/:id', (req, res) => res.end(JSON.stringify({ url: req.url, path: req.path, params: req.params, original: req.originalUrl })))
      v1.get('/boom', () => { throw new Error('nested') })
      v1.get('/through', (req, res, next) => next())
      api.use('/v1', v1)
      router.use('/api/:tenant', api)
      router.use('/api/:tenant', (req, res) => res.end(JSON.stringify({ url: req.url, params: req.params })))

      const strictChild = trie({ id: 'child' })
      strictChild.get('/x', (req, res) => res.end('child-x'))
      router.use('/mount', strictChild)

      server = app.server
      server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; done() })
    })
    after(() => { server.closeAllConnections?.(); server.close() })

    it('routes params and query end to end', async () => {
      const res = await request(base).get('/hello/bob?x=1&x=2')
      expect(res.status).to.equal(200)
      expect(res.text).to.equal('hi bob {"x":["1","2"]}')
    })

    it('rewrites and restores the url through two nested levels', async () => {
      const res = await request(base).get('/api/acme/v1/items/7?q=1')
      expect(res.status).to.equal(200)
      expect(JSON.parse(res.text)).to.deep.equal({ url: '/items/7?q=1', path: '/items/7', params: { tenant: 'acme', id: '7' }, original: '/api/acme/v1/items/7?q=1' })
    })

    it('restores url and params for the parent chain after a nested fall-through', async () => {
      const res = await request(base).get('/api/acme/v1/through')
      expect(res.status).to.equal(200)
      expect(JSON.parse(res.text)).to.deep.equal({ url: '/api/acme/v1/through', params: { tenant: 'acme' } })
    })

    it('mounts static prefixes', async () => {
      expect((await request(base).get('/mount/x')).text).to.equal('child-x')
      expect((await request(base).get('/mount/x/')).text).to.equal('child-x')
      expect((await request(base).get('/mountx/x')).status).to.equal(404)
    })

    it('bubbles nested errors to the parent error handler', async () => {
      const res = await request(base).get('/api/acme/v1/boom')
      expect(res.status).to.equal(500)
      expect(res.text).to.equal('handled:nested')
    })

    it('routes sync throws, async rejections and next(err) to the error handler', async () => {
      for (const p of ['sync', 'async', 'next']) {
        const res = await request(base).get('/' + p)
        expect(res.status).to.equal(500)
        expect(res.text).to.equal('handled:' + p)
      }
    })

    it('survives an error thrown after headers were sent', async () => {
      const crashes = []
      const onCrash = (e) => crashes.push(e)
      process.on('uncaughtException', onCrash)
      try {
        const res = await request(base).get('/late')
        expect(res.status).to.equal(200)
      } finally { process.off('uncaughtException', onCrash) }
      expect(crashes).to.deep.equal([])
      expect((await request(base).get('/hello/again')).status).to.equal(200)
    })

    it('returns 404 from the default route and keeps middleware order', async () => {
      log.length = 0
      const res = await request(base).get('/nothing/here')
      expect(res.status).to.equal(404)
      expect(log).to.deep.equal(['pre /nothing/here'])
    })

    it('never lets a query string become the nested router path', async () => {
      const res = await request(base).get('/api/acme/v1?x=/boom')
      expect(res.status).to.equal(200)
      expect(JSON.parse(res.text)).to.deep.equal({ url: '/?x=/boom', params: { tenant: 'acme' } })
      const res2 = await request(base).get('/api/acme/v1/items/7?x=/boom')
      expect(JSON.parse(res2.text).url).to.equal('/items/7?x=/boom')
    })

    it('contains a user error handler that writes after the response ended', async () => {
      const app = cero({ router: trie({ errorHandler: (err, req, res) => { res.statusCode = 500; res.end('handled:' + err.message) } }) })
      app.router.get('/end-then-throw', (req, res) => { res.end('done'); throw new Error('late') })
      app.router.get('/end-then-next', (req, res, next) => { res.end('done'); next(new Error('late')) })
      await new Promise(resolve => app.server.listen(0, resolve))
      const b = `http://127.0.0.1:${app.server.address().port}`
      const crashes = []
      const onCrash = (e) => crashes.push(e)
      process.on('uncaughtException', onCrash)
      try {
        for (const p of ['/end-then-throw', '/end-then-next']) {
          const res = await request(b).get(p)
          expect(res.text).to.equal('done')
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      } finally {
        process.off('uncaughtException', onCrash)
        app.server.closeAllConnections?.(); app.server.close()
      }
      expect(crashes).to.deep.equal([])
    })

    it('contains a throwing or rejecting defaultRoute', async () => {
      const bodies = []
      const mk = () => ({ statusCode: 200, headersSent: false, setHeader () {}, end (b) { bodies.push(b) } })
      const r = trie({ defaultRoute: () => { throw new Error('d404') }, errorHandler: (e, req, res) => res.end('EH:' + e.message) })
      r.lookup({ method: 'GET', url: '/nothing' }, mk())
      const ra = trie({ defaultRoute: async () => { throw new Error('a404') }, errorHandler: (e, req, res) => res.end('EH:' + e.message) })
      await ra.lookup({ method: 'GET', url: '/nothing' }, mk())
      const chain = trie({ defaultRoute: () => { throw new Error('c404') }, errorHandler: (e, req, res) => res.end('EH:' + e.message) })
      chain.use((req, res, next) => next())
      chain.lookup({ method: 'GET', url: '/nothing' }, mk())
      expect(bodies).to.deep.equal(['EH:d404', 'EH:a404', 'EH:c404'])
    })

    it('survives a throwing custom error handler with a bare 500', () => {
      const r = trie({ errorHandler: () => { throw new Error('broken handler') } })
      r.get('/x', () => { throw new Error('x') })
      const res = { headersSent: false, statusCode: 0, body: '', setHeader () {}, end (b) { this.body = b } }
      expect(() => r.lookup({ method: 'GET', url: '/x' }, res)).to.not.throw()
      expect(res.statusCode).to.equal(500)
      expect(res.body).to.equal('Internal Server Error')
    })
  })
})
