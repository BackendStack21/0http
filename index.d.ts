declare module "0http" {
  interface IRouter {
    lookup: (req: Request, res: Response, step?: VoidFunction) => void;
  }

  type SequentialRouter = IRouter &
    import("trouter").default & {
      on: (
        method: import("trouter").Methods,
        pattern: import("trouter").Pattern,
        handlers: Array<(req: Request, res: Response) => void>
      ) => SequentialRouter;
    };

  interface IBuildServerAndRouterConfig<
    R extends IRouter,
    S extends import("http").Server
  > {
    router?: R;
    server?: S;
    prioRequestsProcessing?: boolean;
  }

  type BuildServerAndRouter = <
    R extends IRouter = SequentialRouter,
    S extends import("http").Server = import("http").Server
  >(
    config?: IBuildServerAndRouterConfig<R, S>
  ) => {
    router: R;
    server: S;
  };

  const buildServerAndRouter: BuildServerAndRouter;
  export default buildServerAndRouter;
}
