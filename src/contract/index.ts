// Public barrel for `@kaonashi-dev/techne/contract` — a typed RPC client + codegen for the
// Techne. Two surfaces:
//
//   import { createClient } from "@kaonashi-dev/techne/contract";
//   const api = createClient<Routes>("http://localhost:3000");
//
//   // and the codegen, used by `techne generate client`:
//   import { generateRoutesType } from "@kaonashi-dev/techne/contract";

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
