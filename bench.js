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
import('mitata').then(({ run, bench, group }) => {
  group('Routers', () => {
    bench('Next Router Parameter URL', () => {
      const req = getReqObject('/0')
      const res = getResObject()

      router.lookup(req, res)
    }).gc('inner')
    bench('Previous Router Parameter URL', () => {
      const req = getReqObject('/0')
      const res = getResObject()

      routerPrevious.lookup(req, res)
    }).gc('inner')
    bench('Next Router Not Found URL', () => {
      const req = getReqObject('/0/404')
      const res = getResObject()

      router.lookup(req, res)
    }).gc('inner')
    bench('Previous Router Not Found URL', () => {
      const req = getReqObject('/0/404')
      const res = getResObject()

      routerPrevious.lookup(req, res)
    }).gc('inner')
    bench('Next Router Error URL', () => {
      const req = getReqObject('/0/error')
      const res = getResObject()

      router.lookup(req, res)
    }).gc('inner')
    bench('Previous Router Error URL', () => {
      const req = getReqObject('/0/error')
      const res = getResObject()

      routerPrevious.lookup(req, res)
    }).gc('inner')
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
