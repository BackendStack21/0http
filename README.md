# 0http
Cero friction HTTP request router. The need for speed!  

## Usage
```js
const cero = require('0http')

const { 
  router,   // https://www.npmjs.com/package/find-my-way
  server    // https://nodejs.org/api/http.html#http_class_http_server
} = cero()

router.on('GET', '/hi', (req, res) => {
  res.end('Hello World!')
})

server.listen(3000)
```

## Benchmarks
Node version: v10.14.1  
Laptop: MacBook Pro 2016, 2,7 GHz Intel Core i7, 16 GB 2133 MHz LPDDR3

```bash
wrk -t8 -c50 -d5s http://127.0.0.1:3000/hi
```

- 0http v1.x            
  `Requests/sec:  54931.66`
- restana v2.10.x       
  `Requests/sec:  53753.83`

> **Note**: `restana` is already the fastest Node.js framework listed in https://github.com/the-benchmarker/web-frameworks