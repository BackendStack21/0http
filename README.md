# Introduction
[![NPM version](https://badgen.net/npm/v/0http)](https://www.npmjs.com/package/0http)
[![NPM Total Downloads](https://badgen.net/npm/dt/0http)](https://www.npmjs.com/package/0http)
[![License](https://badgen.net/npm/license/0http)](https://www.npmjs.com/package/0http)
[![TypeScript support](https://badgen.net/npm/types/0http)](https://www.npmjs.com/package/0http)
[![Github stars](https://badgen.net/github/stars/jkyberneees/0http?icon=github)](https://github.com/jkyberneees/0http)

<img src="docs/0http-logo.svg" width="400">  

Zero friction HTTP framework:
- Tweaked Node.js HTTP server for high throughput.
- High-performance and customizable request routers. 

![Performance Benchmarks](docs/Benchmarks.png) 

> Check it yourself: https://web-frameworks-benchmark.netlify.app/result?f=feathersjs,0http,koa,fastify,nestjs-express,express,sails,nestjs-fastify,restana

## Usage
```js
const cero = require('0http')
const { router, server } = cero()

router.get('/hello', (req, res) => {
  res.end('Hello World!')
})

router.post('/do', (req, res) => {
  // ...
  res.statusCode = 201
  res.end()
})

//...

server.listen(3000)
```

# Support / Donate 💚
You can support the maintenance of this project: 
- PayPal: https://www.paypal.me/kyberneees
- [TRON](https://www.binance.com/en/buy-TRON) Wallet: `TJ5Bbf9v4kpptnRsePXYDvnYcYrS5Tyxus`

# More
- Website and documentation: https://0http.21no.de