import { type Server as HTTPServer, IncomingMessage, ServerResponse } from "http";
import { type Server as HTTPSServer } from "https";
import Trouter, { Methods, Pattern } from "trouter";
import {
  Http2SecureServer,
  Http2ServerRequest,
  Http2ServerResponse
} from 'http2'

declare namespace zero {
  export enum Protocol {
    HTTP = 'http',
    HTTPS = 'https',
    HTTP2 = 'http2'
  }

  type Server<P extends Protocol> = P extends Protocol.HTTP2 ? Http2SecureServer : P extends Protocol.HTTPS ? HTTPSServer : HTTPServer
  type StepFunction = (error?: unknown) => void

  type Request<P extends Protocol> = P extends Protocol.HTTP2
    ? Http2ServerRequest
    : IncomingMessage

  type Response<P extends Protocol> = P extends Protocol.HTTP2
    ? Http2ServerResponse : ServerResponse

  type RequestHandler<P extends Protocol> = (
    req: Request<P>,
    res: Response<P>,
    next: (error?: unknown) => void
  ) => void | Promise<unknown>

  interface IRouter {
    lookup: (req: IncomingMessage, res: ServerResponse, step?: StepFunction) => void;
  }

  export class SequentialRouter<P extends Protocol> extends Trouter<RequestHandler<P>> implements IRouter {
    id?: string;
    lookup(req: IncomingMessage, res: ServerResponse, step?: StepFunction): void;

    use(prefix: string, ...middlewares: RequestHandler<P>[]): this;
    use(...middlewares: RequestHandler<P>[]): this;

    on(method: Methods, pattern: Pattern, ...middlewares: RequestHandler<P>[]): this;
  }

  interface IBuildServerAndRouterConfig<Server, R extends IRouter> {
    router?: R;
    server?: Server;
    prioRequestsProcessing?: boolean;
  }

  export function zero<P extends Protocol, R extends IRouter>(config?: IBuildServerAndRouterConfig<Server<P>, R>): {
    server: Server<P>,
    router: R
  };
}

export default zero;
