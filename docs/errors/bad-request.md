# Bad Request

This page documents the Techne RFC 7807 problem document for HTTP `bad-request` errors.

A problem+json response with `type` of `https://github.com/kaonashi-dev/techne/blob/main/docs/errors/bad-request.md` indicates the server encountered a Bad Request condition.

```json
{
  "type": "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/bad-request.md",
  "title": "Bad Request",
  "status": <status>,
  "detail": "<human-readable explanation>",
  "code": "<optional stable machine-readable code>",
  "instance": "<request URL path>",
  "requestId": "<uuid>"
}
```

For the full error contract and `HttpException` reference, see the [Techne README](../../README.md#exceptions).
