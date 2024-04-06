const httpNext = require('./index')
const httpPrevious = require('0http')

function getReqObject (url) {
  const req = {}
  req.method = 'GET'
  req.url = url

  return req
}

function getResObject () {
  const res = {}
  res.statusCode = null
  res.setHeader = () => {}
  res.writeHead = () => {}
  res.end = () => {}
  return res
}

function setupRouter (router) {
  router.use((req, res, next) => {
    return next()
  })

  router.get('/', (req, res) => {
    return res.end('OK')
  })
  router.get('/:id', (req, res) => {
    return res.end(req.params.id)
  })
  router.get('/:id/error', () => {
    throw new Error('Error')
  })
}

const { router } = httpNext({
  cacheSize: 0,
  id: '/'
})
setupRouter(router)

const { router: routerPrevious } = httpPrevious({
  cacheSize: 0
})
setupRouter(routerPrevious)

import('mitata/src/cli.mjs').then(({ run, bench, group, baseline }) => {
  group('Next Router', () => {
    baseline('Base URL', () => {
      const req = getReqObject('/')
      const res = getResObject()

      router.lookup(req, res)
    })
    bench('Parameter URL', () => {
      const req = getReqObject('/0')
      const res = getResObject()

      router.lookup(req, res)
    })
    bench('Not Found URL', () => {
      const req = getReqObject('/0/404')
      const res = getResObject()

      router.lookup(req, res)
    })
    bench('Error URL', () => {
      const req = getReqObject('/0/error')
      const res = getResObject()

      router.lookup(req, res)
    })
  })

  group('Previous Router', () => {
    baseline('Base URL', () => {
      const req = getReqObject('/')
      const res = getResObject()

      routerPrevious.lookup(req, res)
    })
    bench('Parameter URL', () => {
      const req = getReqObject('/0')
      const res = getResObject()

      routerPrevious.lookup(req, res)
    })
    bench('Not Found URL', () => {
      const req = getReqObject('/0/404')
      const res = getResObject()

      routerPrevious.lookup(req, res)
    })
    bench('Error URL', () => {
      const req = getReqObject('/0/error')
      const res = getResObject()

      routerPrevious.lookup(req, res)
    })
  })

  run({
    silent: false,
    avg: true,
    json: false,
    colors: true,
    min_max: false,
    percentiles: false
  })
})
