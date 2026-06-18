import type { HttpResponse } from "./http-response";
import type { ProblemDocument } from "../contract/types";

export class RequestException extends Error {
  readonly response: HttpResponse;
  readonly status: number;
  readonly problem?: ProblemDocument;

  constructor(response: HttpResponse, problem?: ProblemDocument) {
    const raw =
      problem?.title ??
      `HTTP request returned a client or server error response [${response.status()}]`;
    super(raw.length > 120 ? raw.slice(0, 120) : raw);
    this.name = "RequestException";
    this.response = response;
    this.status = response.status();
    this.problem = problem;
  }
}

export class ConnectionException extends Error {
  declare readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ConnectionException";
  }
}
