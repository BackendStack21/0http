import { type Server as HTTPServer, IncomingMessage, ServerResponse } from 'http'
import { type Server as HTTPSServer } from 'https'
import { Pattern, Methods } from 'trouter'

import { Http2SecureServer, Http2ServerRequest, Http2ServerResponse } from 'http2'

export enum Protocol {
  HTTP = 'http',
  HTTPS = 'https',
  HTTP2 = 'http2'
}

export type Server<P extends Protocol> = P extends Protocol.HTTP2
  ? Http2SecureServer
  : P extends Protocol.HTTPS
  ? HTTPSServer
  : HTTPServer

export type StepFunction = (error?: unknown) => void

export type Request<P extends Protocol> = P extends Protocol.HTTP2 ? Http2ServerRequest : IncomingMessage

export type Response<P extends Protocol> = P extends Protocol.HTTP2 ? Http2ServerResponse : ServerResponse

export type RequestHandler<P extends Protocol> = (
  req: Request<P>,
  res: Response<P>,
  next: (error?: unknown) => void
) => void | Promise<unknown>

export interface IRouter<P extends Protocol> {
  lookup: RequestHandler<P>

  use(...handlers: RequestHandler<P>[]): this
  use(router: IRouter<P>): this
  use(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  use(prefix: Pattern, router: IRouter<P>): this

  all(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  get(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  head(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  patch(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  options(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  connect(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  delete(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  trace(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  post(pattern: Pattern, ...handlers: RequestHandler<P>[]): this
  put(pattern: Pattern, ...handlers: RequestHandler<P>[]): this

  on(method: Methods, pattern: Pattern, ...middlewares: RequestHandler<P>[]): this
}
