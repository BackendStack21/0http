import { type Server } from "http";
import Trouter, { Methods, Pattern } from "trouter";

declare namespace zeroHttp {
  interface IRouter {
    lookup: (req: Request, res: Response, step?: VoidFunction) => void;
  }

  type SequentialRouter = IRouter &
    Trouter & {
      on: (
        method: Methods,
        pattern: Pattern,
        handlers: Array<(req: Request, res: Response) => void>
      ) => SequentialRouter;
    };

  interface IBuildServerAndRouterConfig<R extends IRouter, S extends Server> {
    router?: R;
    server?: S;
    prioRequestsProcessing?: boolean;
  }
}

declare function buildServerAndRouter<
  R extends zeroHttp.IRouter = zeroHttp.SequentialRouter,
  S extends Server = Server
>(config?: zeroHttp.IBuildServerAndRouterConfig<R, S>): any;

export = buildServerAndRouter;
