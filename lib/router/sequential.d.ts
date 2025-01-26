import { Protocol, IRouter } from "./../../common";

export default function createSequentialRouter<P extends Protocol>(config?: object): IRouter<P>;
