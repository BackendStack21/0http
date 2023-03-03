import { Protocol, IRouter, Server } from './common'

interface IBuildServerAndRouterConfig<P extends Protocol, S extends Server<P>, R extends IRouter<P>> {
  router?: R
  server?: S
  prioRequestsProcessing?: boolean
}

export default function zero<P extends Protocol>(config?: IBuildServerAndRouterConfig<P, Server<P>, IRouter<P>>): {
  server: Server<P>
  router: IRouter<P>
}
