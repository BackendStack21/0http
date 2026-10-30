# Threat model — 0http

## What this project does and where untrusted input enters
- 0http is a high-performance HTTP request router for Node.js (used by restana and fast-gateway).
- All HTTP request data is untrusted: method, URL/path (including encoded and dot segments), query string, and headers.
- Route definitions, middlewares, handlers and router config are trusted application code.

## Components that matter most / least
- In scope, highest priority: `lib/router/sequential.js` (default router, route matching, nested routers, LRU route cache), `lib/router/trie.js`, `lib/next.js` (middleware chain and error propagation), `lib/utils/queryparams.js` (query string parsing).
- In scope: `index.js` (server/router wiring).
- Out of scope: `demos/`, `docs/`, `tooling/`, `bench.js`, `tests/`, devDependencies.

## How to exercise it
- `npm test` runs the mocha suite in `tests/` (see `tests/security-hardening.test.js` and `tests/regression-findings.test.js`).
- Minimal server: `const { router, server } = require('./index')(); router.get('/:id', (req, res) => res.end(req.params.id)); server.listen(3000)`.

## How you rate severity
- Critical: remote code execution, or a crafted path/method that dispatches to a route or skips a middleware it should not (e.g. auth middleware bypass via encoding, casing, or nested-router prefixes).
- High: a single request that crashes the process, prototype pollution via `req.query`/`req.params`, unbounded memory growth from attacker-chosen paths (route cache poisoning).
- Medium: ReDoS or CPU exhaustion needing sustained traffic, incorrect but non-bypassing route matching.
- Low: hardening suggestions.

## Anything to leave alone
- Performance-motivated design choices that are not exploitable (e.g. not normalizing paths beyond what is documented).
- Advisories that only affect devDependencies.
