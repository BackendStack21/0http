import { Protocol, IRouter } from './../../common'

export interface TrieRouterConfig {
  /** Handler for requests no route matched. Default: 404 with an empty body. */
  defaultRoute?: (req: any, res: any) => void
  /** Handler invoked for sync throws, rejected promises and next(err). */
  errorHandler?: (err: unknown, req: any, res: any) => void | Promise<unknown>
  /** Router identifier used when mounted as a nested router. */
  id?: string
  /** Match paths case-sensitively. Default: true. */
  caseSensitive?: boolean
  /** Treat `/users/` and `/users` as the same path. Default: true. */
  ignoreTrailingSlash?: boolean
}

export default function createTrieRouter<P extends Protocol>(config?: TrieRouterConfig): IRouter<P>
