# Internal Server Error

This page documents the Techne RFC 7807 problem document for HTTP `internal-server-error` errors.

A problem+json response with `type` of `https://github.com/kaonashi-dev/techne/blob/main/docs/errors/internal-server-error.md` indicates the server encountered a Internal Server Error condition.

```json
{
  "type": "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/internal-server-error.md",
  "title": "Internal Server Error",
  "status": <status>,
  "detail": "<human-readable explanation>",
  "code": "<optional stable machine-readable code>",
  "instance": "<request URL path>",
  "requestId": "<uuid>"
}
```

For the full error contract and `HttpException` reference, see the [Techne README](../../README.md#exceptions).
