/**
 * Representative endpoints exercised by the oha load test. Each maps to a
 * distinct framework code path:
 *  - a static fast GET, a parameterised GET, a validated POST,
 *  - a JWT+roles guarded GET, and the plugin-registered /metrics route.
 *
 * `auth: true` means the runner injects the `Authorization: Bearer <jwt>`
 * header obtained from the login route before measuring.
 */
export interface PerfEndpoint {
  name: string;
  method: "GET" | "POST";
  /** Path relative to the server origin (already includes the version + prefix). */
  path: string;
  body?: unknown;
  auth?: boolean;
}

export const API_PREFIX = "/v1/api";

export const endpoints: PerfEndpoint[] = [
  { name: "users.list", method: "GET", path: `${API_PREFIX}/users` },
  { name: "users.byId", method: "GET", path: `${API_PREFIX}/users/1` },
  {
    name: "mq.enqueue",
    method: "POST",
    path: `${API_PREFIX}/mq/emails`,
    body: { to: "perf@example.com", subject: "perf" },
  },
  { name: "admin.dashboard", method: "GET", path: `${API_PREFIX}/admin/dashboard`, auth: true },
  { name: "metrics", method: "GET", path: "/metrics" },
];
