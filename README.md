# 0http
Cero friction HTTP framework:
- Tweaked Node.js Server for high throughput.
- The request router you like. 

> If no router is provided, it uses the `find-my-way` router as default implementation.

## Usage
```js
const cero = require('0http')
const { router, server } = cero()

router.on('GET', '/hello', (req, res) => {
  res.end('Hello World!')
})

router.on('POST', '/do', (req, res) => {
  // ...
  res.statusCode = 201
  res.end()
})

//...

server.listen(3000)
```

## Routers
`0http` allows you to define the router implementation you prefer as soon as it support the following interface:
```js
router.lookup = (req, res) // -> should trigger router search and handlers execution
```
### find-my-way router
> https://github.com/delvedor/find-my-way  

This is the default router in `0http` if no router is provided via configuration. Internally uses a [Radix Tree](https://en.wikipedia.org/wiki/Radix_tree) 
router that will bring better performance over iterative regular expressions matching. 

### 0http - sequential
This a `0http` extended implementation of the [trouter](https://www.npmjs.com/package/trouter) router. Includes support for middlewares and shortcuts for routes registration.  
As this is an iterative regular expression matching router, it tends to be slower than `find-my-way` when the number of registered routes increases. However, tiny micro-services should not see major performance degradation.  

Supported HTTP verbs: `GET, HEAD, PATCH, OPTIONS, CONNECT, DELETE, TRACE, POST, PUT`

```js
const cero = require('0http')
const { router, server } = cero({
  router: require('0http/lib/router/sequential')()
})

router.use('/', (req, res, next) => {
  res.write('Hello ')
  next()
})

const routeMiddleware = (req, res, next) => {
  res.write('World')
  next()
}
router.get('/sayhi', routeMiddleware, (req, res) => {
  res.end('!')
})

server.listen(3000)
```
#### Async middlewares
You can user async middlewares to await the remaining chain execution:
```js
router.use('/', async (req, res, next) => {
  try {
    await next()
  } catch (err) {
    res.statusCode = 500
    res.end(err.message)
  }
})

router.get('/sayhi', () => { throw new Error('Uuuups!') }, (req, res) => {
  res.end('!')
})
```
## Servers
`0http` is just a wrapper for the servers and routers implementations you provide. 
```js
const cero = require('0http')

const { router, server } = cero({
  server: yourCustomServerInstance
})
```

### Node.js http.Server 
If no server is provided by configuration, the standard Node.js [http.Server](https://nodejs.org/api/http.html#http_class_http_server) implementation is used.  
Because this server offers the best balance between Node.js ecosystem compatibility and performance, we highly recommend it for most use cases.

### Low Server
`low` is a tiny Node.js friendly wrapper around the great [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) HTTP server. I/O throughput is 
maximized at the cost of API compatibility.
> As far as for Node.js, `uWebSockets.js` brings the best I/O performance in terms of HTTP support.

#### Install dependencies
```
npm i uNetworking/uWebSockets.js#v15.11.0
```
#### Example usage
```js
const low = require('0http/lib/server/low')
const cero = require('0http')

const { router, server } = cero({
  server: low()
})

router.on('GET', '/hi', (req, res) => {
  res.end('Hello World!')
})

server.listen(3000, (socket) => {
  if (socket) {
    console.log('HTTP server ready!')
  }
})


// ...
server.close()
```


## Benchmarks (22/07/2019)
**Node version**: v10.16.0  
**Laptop**: MacBook Pro 2016, 2,7 GHz Intel Core i7, 16 GB 2133 MHz LPDDR3  
**Server**: Single instance

```bash
wrk -t8 -c8 -d5s http://127.0.0.1:3000/hi
```

### 1 route registered
- **0http (find-my-way + low)**
  `Requests/sec:  121006.70`
- 0http (find-my-way) 
  `Requests/sec:  68101.15`
- 0http (sequential) 
  `Requests/sec:  67124.65`
- restana v3.3.1       
  `Requests/sec:  59519.98`

### 5 routes registered
- 0http (find-my-way) 
  `Requests/sec:  68067.34`
- 0http (sequential) 
  `Requests/sec:  64141.28`
- restana v3.3.1       
  `Requests/sec:  59501.34`

> For more accurate benchmarks please see:
> - https://github.com/the-benchmarker/web-frameworks