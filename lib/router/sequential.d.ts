import { Protocol, IRouter, RequestHandler } from './../../common'

export default function createSequentialRouter<P extends Protocol>(config?: object): IRouter<P>
