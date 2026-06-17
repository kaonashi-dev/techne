// Public barrel for `@kaonashi-dev/techne/http` — a Laravel-style fluent HTTP client built on
// native `fetch`. Three surfaces:
//
//   import { Http } from "@kaonashi-dev/techne/http";
//   const res = await Http.withToken(token).acceptJson().get("https://api.example.com/users");
//
//   import { createHttpClient } from "@kaonashi-dev/techne/http";
//   const github = createHttpClient({ baseUrl: "https://api.github.com", token: env.GH });
//
//   // In tests:
//   Http.fake({ "*": Http.response({ ok: true }) });
//   Http.assertSentCount(1);

export { Http, createHttpClient } from "./factory";
export { PendingRequest } from "./pending-request";
export { HttpResponse } from "./http-response";
export { RequestException, ConnectionException } from "./exceptions";
export { ResponseSequence, RecordedRequest, buildFakeResponse as response } from "./fake";
export { Pool, Batch } from "./pool";

export type {
  HttpClientOptions,
  RetryConfig,
  BodyFormat,
  RequestMiddlewareFn,
  ResponseMiddlewareFn,
  FakeBody,
  FakeResponder,
  ProblemDocument,
} from "./types";
