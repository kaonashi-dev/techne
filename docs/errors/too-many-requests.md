# Too Many Requests

This page documents the Techne RFC 7807 problem document for HTTP `too-many-requests` errors.

A problem+json response with `type` of `https://github.com/kaonashi-dev/techne/blob/main/docs/errors/too-many-requests.md` indicates the server encountered a Too Many Requests condition.

```json
{
  "type": "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/too-many-requests.md",
  "title": "Too Many Requests",
  "status": <status>,
  "detail": "<human-readable explanation>",
  "code": "<optional stable machine-readable code>",
  "instance": "<request URL path>",
  "requestId": "<uuid>"
}
```

Rate-limited responses produced by the built-in limiter (`rateLimit` option or
`@RateLimit` decorator) additionally carry these headers:

- `Retry-After` — seconds until the next request would be allowed.
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` — IETF draft
  rate-limit headers (`RateLimit-Reset` is an epoch timestamp in seconds).
  Suppressed when the limiter is configured with `headers: false`.

For the full error contract and `HttpException` reference, see the [Techne README](../../README.md#exceptions).
