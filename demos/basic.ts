import zero from '../index'
import { createServer } from 'node:http'
import createRouter from '../lib/router/sequential'
import { Protocol } from '../common'

const { router, server } = zero<Protocol.HTTP>({
  router: createRouter<Protocol.HTTP>(),
  server: createServer()
})

router.use((req, res, next) => {
  return next()
})

router.get('/hi', (req, res) => {
  res.end(`Hello World from TS!`)
})

server.listen(3000)
