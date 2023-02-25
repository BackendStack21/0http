import { type Server as HTTPServer, IncomingMessage, ServerResponse } from "http";
import { type Server as HTTPSServer } from "https";
import Trouter, { Methods, Pattern } from "trouter";

type Server = HTTPServer | HTTPSServer;

declare namespace zeroHttp {
  interface IRouter {
    lookup: (req: IncomingMessage, res: ServerResponse, step?: VoidFunction) => void;
  }

  class SequentialRouter extends Trouter<VoidFunction> implements IRouter {
    id: string;
    lookup(req: IncomingMessage, res: ServerResponse, step?: VoidFunction): void;

    use(prefix: string, ...middlewares: VoidFunction[]): this;
    use(...middlewares: VoidFunction[]): this;

    on(method: Methods, pattern: Pattern, ...middlewares: VoidFunction[]): this;
  }

  interface IBuildServerAndRouterConfig<R extends IRouter, S extends Server> {
    router?: R;
    server?: S;
    prioRequestsProcessing?: boolean;
  }
}

declare function buildServerAndRouter<
  R extends zeroHttp.IRouter = zeroHttp.SequentialRouter,
  S extends Server = HTTPServer
>(config?: zeroHttp.IBuildServerAndRouterConfig<R, S>): {
  server: S,
  router: R
};

export = buildServerAndRouter;
