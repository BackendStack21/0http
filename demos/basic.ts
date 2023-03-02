import zero from './../index'
import sequentialBuilder from './../lib/router/sequential'
import { Protocol } from './../common'

const { router, server } = zero<Protocol.HTTP>({
  router: sequentialBuilder<Protocol.HTTP>()
})

router.use((req, res, next) => {
  return next()
})

router.get('/hi', (req, res) => {
  res.end(`Hello World from TS!`)
})

server.listen(3000)
