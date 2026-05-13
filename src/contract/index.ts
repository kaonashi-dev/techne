// Public barrel for `@bnest/contract` — a typed RPC client + codegen for
// Bnest. Two surfaces:
//
//   import { createClient } from "@kaonashi-dev/bnest/contract";
//   const api = createClient<Routes>("http://localhost:3000");
//
//   // and the codegen, used by `bnest generate client`:
//   import { generateRoutesType } from "@kaonashi-dev/bnest/contract";

export { createClient } from "./client";
export { generateRoutesType, typeboxToTypeScript } from "./codegen";
export {
  ClientError,
  type ClientOptions,
  type ClientRequest,
  type ClientResponse,
  type HttpMethod,
  type ProblemDocument,
  type RouteHandler,
  type RouteMap,
  type TypedClient,
} from "./types";
