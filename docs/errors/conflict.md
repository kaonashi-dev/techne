# Conflict

This page documents the Techne RFC 7807 problem document for HTTP `conflict` errors.

A problem+json response with `type` of `https://github.com/kaonashi-dev/techne/blob/main/docs/errors/conflict.md` indicates the server encountered a Conflict condition.

```json
{
  "type": "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/conflict.md",
  "title": "Conflict",
  "status": <status>,
  "detail": "<human-readable explanation>",
  "code": "<optional stable machine-readable code>",
  "instance": "<request URL path>",
  "requestId": "<uuid>"
}
```

For the full error contract and `HttpException` reference, see the [Techne README](../../README.md#exceptions).
