#!/usr/bin/env python3
"""Report generator for the 2026-11-05 Techne benchmark run.

Reads two full runs captured today plus the committed baseline and emits a
self-contained markdown report. Kept next to the raw JSON so every number in the
report can be traced back to the artifacts.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_A = ROOT / "bench/runs/2026-11-05.json"
RUN_B = ROOT / "bench/runs/2026-11-05-b.json"
BASELINE = ROOT / "bench/baseline.json"
OUT = ROOT / "bench/reports/2026-11-05.md"

THRESHOLD = 0.10


def load(path: Path) -> dict:
    with path.open() as fh:
        return json.load(fh)


def fmt_rps(value: float) -> str:
    return f"{round(value):,}"


def fmt_us(value: float) -> str:
    if value < 10:
        return f"{value:.2f}"
    if value < 100:
        return f"{value:.1f}"
    return f"{round(value):,}"


def fmt_pct(delta: float) -> str:
    return f"{delta * 100:+.1f}%"


def fmt_delta(delta: float | None) -> str:
    if delta is None:
        return "—"
    if abs(delta) < THRESHOLD:
        return "≈"
    text = fmt_pct(delta)
    return f"**{text}**" if delta > 0 else text


def index(matrix: dict) -> dict[tuple[str, str, str], dict]:
    out: dict[tuple[str, str, str], dict] = {}
    for section in matrix["sections"]:
        for row in section["results"]:
            out[(section["title"], row["name"], row["request"])] = row
    return out


def get(matrix: dict, key: tuple[str, str, str]) -> dict:
    return index(matrix)[key]


def delta(new: float, old: float) -> float | None:
    return (new - old) / old if old else None


def render_results(matrix: dict) -> str:
    chunks: list[str] = []
    for section in matrix["sections"]:
        chunks.append(f"### {section['title']}\n")
        chunks.append(
            "| Scenario | Request | req/s | avg µs | p50 µs | p95 µs | p99 µs |\n"
            "| --- | --- | ---: | ---: | ---: | ---: | ---: |"
        )
        for row in section["results"]:
            chunks.append(
                f"| {row['name']} | {row['request']} | {fmt_rps(row['rps'])} | "
                f"{fmt_us(row['avgUs'])} | {fmt_us(row['p50Us'])} | "
                f"{fmt_us(row['p95Us'])} | {fmt_us(row['p99Us'])} |"
            )
        chunks.append("")
    return "\n".join(chunks)


def render_memory(matrix: dict) -> str:
    chunks = [
        "| Routes | boot ms | RSS MB | RSS after load MB | growth MB | heap MB | per-route KB |\n"
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    ]
    for row in matrix.get("memory") or []:
        per_route = "—" if row["perRouteKb"] is None else f"{row['perRouteKb']:.1f}"
        chunks.append(
            f"| {row['routes']} | {row['bootMs']:.1f} | "
            f"{row['afterBoot']['rssBytes'] / 1024 / 1024:.1f} | "
            f"{row['afterLoad']['rssBytes'] / 1024 / 1024:.1f} | "
            f"{row['loadGrowthMb']:.1f} | "
            f"{row['afterBoot']['heapUsedBytes'] / 1024 / 1024:.1f} | {per_route} |"
        )
    return "\n".join(chunks)


def compare(baseline: dict, current: dict) -> tuple[str, dict]:
    base_idx = index(baseline)
    cur_idx = index(current)
    keys = [k for k in cur_idx if k in base_idx]

    chunks = [
        "| Section | Scenario | Request | baseline req/s | run A req/s | Δ throughput |",
        "| --- | --- | --- | ---: | ---: | ---: |",
    ]
    deltas: list[float] = []
    for key in keys:
        b = base_idx[key]
        c = cur_idx[key]
        d = delta(c["rps"], b["rps"])
        if d is not None:
            deltas.append(d)
        chunks.append(
            f"| {key[0]} | {key[1]} | {key[2]} | {fmt_rps(b['rps'])} | "
            f"{fmt_rps(c['rps'])} | {fmt_delta(d)} |"
        )

    geo = math.exp(sum(math.log(1 + d) for d in deltas) / len(deltas)) - 1
    summary = {
        "matched": len(deltas),
        "geomean": geo,
        "improvements": sum(1 for d in deltas if d > THRESHOLD),
        "regressions": sum(1 for d in deltas if d < -THRESHOLD),
        "noise": sum(1 for d in deltas if abs(d) <= THRESHOLD),
    }
    return "\n".join(chunks), summary


def noise(a: dict, b: dict) -> dict:
    a_idx = index(a)
    b_idx = index(b)
    rows = []
    for key in a_idx:
        if key not in b_idx:
            continue
        ra, rb = a_idx[key], b_idx[key]
        d = delta(rb["rps"], ra["rps"])
        if d is not None:
            rows.append((key, ra, rb, d))

    magnitudes = sorted(abs(r[3]) for r in rows)
    over_10 = [r for r in rows if abs(r[3]) > 0.10]
    over_25 = [r for r in rows if abs(r[3]) > 0.25]

    table = [
        "| Section | Scenario | Request | run A req/s | run B req/s | Δ |",
        "| --- | --- | --- | ---: | ---: | ---: |",
    ]
    for key, ra, rb, d in sorted(over_10, key=lambda r: abs(r[3]), reverse=True):
        table.append(
            f"| {key[0]} | {key[1]} | {key[2]} | {fmt_rps(ra['rps'])} | "
            f"{fmt_rps(rb['rps'])} | {fmt_delta(d)} |"
        )

    return {
        "matched": len(rows),
        "median": magnitudes[len(magnitudes) // 2],
        "p90": magnitudes[min(len(magnitudes) - 1, math.floor(0.9 * len(magnitudes)))],
        "max": magnitudes[-1],
        "over10": len(over_10),
        "over25": len(over_25),
        "table": "\n".join(table),
        "by_key": {r[0]: r[3] for r in rows},
        "geo": math.exp(sum(math.log(1 + r[3]) for r in rows) / len(rows)) - 1,
    }


def cross_name_native(baseline: dict, current: dict) -> str:
    pairs = [
        ("Fast path (no enhancers)", "Elysia (fast)", "Native (fast)", "GET /users"),
        ("Fast path (no enhancers)", "Elysia (fast)", "Native (fast)", "GET /users/:id"),
        ("Loopback TCP (real socket)", "Elysia (socket)", "Native (socket)", "GET /users"),
        ("Loopback TCP (real socket)", "Elysia (socket)", "Native (socket)", "GET /users/:id"),
    ]
    chunks = [
        "| Section | Request | baseline req/s | run A req/s | Δ |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for section, old_name, new_name, request in pairs:
        b = get(baseline, (section, old_name, request))
        c = get(current, (section, new_name, request))
        chunks.append(
            f"| {section} | {request} | {fmt_rps(b['rps'])} | {fmt_rps(c['rps'])} | "
            f"{fmt_delta(delta(c['rps'], b['rps']))} |"
        )
    return "\n".join(chunks)


def main() -> None:
    a = load(RUN_A)
    b = load(RUN_B)
    baseline = load(BASELINE)
    ai, bi = index(a), index(b)

    def ra(key):
        return ai[key]

    def rb(key):
        return bi[key]

    def pair(key):
        return ai[key], bi[key]

    comp_table, comp_a = compare(baseline, a)
    _, comp_b = compare(baseline, b)
    nz = noise(a, b)
    native_table = cross_name_native(baseline, a)

    K = {
        "native_users": ("Fast path (no enhancers)", "Native (fast)", "GET /users"),
        "native_id": ("Fast path (no enhancers)", "Native (fast)", "GET /users/:id"),
        "fast_users": ("Fast path (no enhancers)", "Techne (fast)", "GET /users"),
        "fast_id": ("Fast path (no enhancers)", "Techne (fast)", "GET /users/:id"),
        "slow_users": ("Slow path (static guard)", "Techne (slow)", "GET /users (guarded)"),
        "slow_id": ("Slow path (static guard)", "Techne (slow)", "GET /users/:id (guarded)"),
        "valid": ("Request validation", "Techne (validation)", "POST /users (valid)"),
        "invalid": ("Request validation", "Techne (validation)", "POST /users (invalid)"),
        "typed": (
            "Response schema (stringifier)",
            "Techne (response)",
            "GET /users/typed (schema)",
        ),
        "plain": (
            "Response schema (stringifier)",
            "Techne (response)",
            "GET /users/plain (no schema)",
        ),
        "cors_allow": ("CORS", "Techne (CORS)", "GET /cors (allow-list origin)"),
        "cors_echo": ("CORS", "Techne (CORS)", "GET /cors (echo origin)"),
        "di_top_warm": ("Dependency injection", "DI", "TopLevelService (warm)"),
        "di_dep_warm": ("Dependency injection", "DI", "DependencyA (warm)"),
        "di_top_cold": ("Dependency injection", "DI", "TopLevelService (cold)"),
        "di_dep_cold": ("Dependency injection", "DI", "DependencyA (cold)"),
        "cold_1": ("Cold start", "Cold start", "N=1 bootstrap"),
        "cold_10": ("Cold start", "Cold start", "N=10 bootstrap"),
        "cold_50": ("Cold start", "Cold start", "N=50 bootstrap"),
        "ip_1": ("Cold start (in-process)", "Cold start (in-process)", "N=1 (20 iters)"),
        "ip_10": ("Cold start (in-process)", "Cold start (in-process)", "N=10 (20 iters)"),
        "ip_50": ("Cold start (in-process)", "Cold start (in-process)", "N=50 (20 iters)"),
        "client_bare": ("Outgoing HTTP client", "Techne HTTP client", "GET (bare)"),
        "client_query": ("Outgoing HTTP client", "Techne HTTP client", "GET (query + headers)"),
        "client_post": ("Outgoing HTTP client", "Techne HTTP client", "POST (json body)"),
        "client_token": ("Outgoing HTTP client", "Techne HTTP client", "POST (token + json)"),
        "sock_native_users": ("Loopback TCP (real socket)", "Native (socket)", "GET /users"),
        "sock_native_id": ("Loopback TCP (real socket)", "Native (socket)", "GET /users/:id"),
        "sock_users": ("Loopback TCP (real socket)", "Techne (socket)", "GET /users"),
        "sock_id": ("Loopback TCP (real socket)", "Techne (socket)", "GET /users/:id"),
    }

    r = {name: ra(key) for name, key in K.items()}
    r_b = {name: rb(key) for name, key in K.items()}
    mem_a = {m["routes"]: m for m in a["memory"]}
    mem_b = {m["routes"]: m for m in b["memory"]}

    fast_gap_a = r["native_users"]["rps"] / r["fast_users"]["rps"]
    fast_gap_b = r_b["native_users"]["rps"] / r_b["fast_users"]["rps"]
    fast_gap_id_a = r["native_id"]["rps"] / r["fast_id"]["rps"]
    fast_gap_id_b = r_b["native_id"]["rps"] / r_b["fast_id"]["rps"]
    sock_gap_a = r["sock_native_users"]["rps"] / r["sock_users"]["rps"]
    sock_gap_b = r_b["sock_native_users"]["rps"] / r_b["sock_users"]["rps"]
    sock_gap_id_a = r["sock_native_id"]["rps"] / r["sock_id"]["rps"]
    sock_gap_id_b = r_b["sock_native_id"]["rps"] / r_b["sock_id"]["rps"]

    schema_ratio_a = r["typed"]["rps"] / r["plain"]["rps"]
    schema_ratio_b = r_b["typed"]["rps"] / r_b["plain"]["rps"]
    invalid_ratio_a = r["invalid"]["rps"] / r["valid"]["rps"]
    invalid_ratio_b = r_b["invalid"]["rps"] / r_b["valid"]["rps"]
    slow_ratio_a = r["slow_users"]["rps"] / r["fast_users"]["rps"]
    slow_ratio_b = r_b["slow_users"]["rps"] / r_b["fast_users"]["rps"]
    slow_id_ratio_a = r["slow_id"]["rps"] / r["fast_id"]["rps"]
    slow_id_ratio_b = r_b["slow_id"]["rps"] / r_b["fast_id"]["rps"]

    # Rows that looked like regressions against the old baseline in run A.
    regressions = [
        K["di_top_cold"],
        K["di_dep_cold"],
        K["ip_50"],
    ]
    regression_lines = []
    base_idx = index(baseline)
    for key in regressions:
        base_row = base_idx[key]
        a_row, b_row = ai[key], bi[key]
        regression_lines.append(
            f"- **{key[1]} — {key[2]}**: {fmt_rps(base_row['rps'])} → "
            f"{fmt_rps(a_row['rps'])} req/s ({fmt_pct(delta(a_row['rps'], base_row['rps']))} vs baseline); "
            f"run A → run B {fmt_pct(delta(b_row['rps'], a_row['rps']))} "
            f"({a_row['total']} sample{'s' if a_row['total'] != 1 else ''})."
        )

    ip50_vs_base_b = delta(bi[K["ip_50"]]["rps"], base_idx[K["ip_50"]]["rps"])

    cold_start_note = (
        "> **Unit note.** The harness reports cold-start milliseconds scaled to "
        "microseconds, so `3,796 µs` in the table means **3.8 ms**."
    )

    report = f"""# Techne Performance Report — 2026-11-05

**Status:** ✅ No actionable regression. Against the committed baseline, run A
improved 20 of 26 comparable rows (geometric mean **{comp_a['geomean'] * 100:+.1f}%**);
run B improved 24 of 26 (**{comp_b['geomean'] * 100:+.1f}%**). Run A tripped the
10% gate on one 20-sample row (N=50 in-process boot, -10.5%), but that row moved
+24.7% in run B. The only rows below baseline in both runs are **single-sample**
cold-DI probes, which the gate deliberately excludes.

## Executive summary

| Metric | Run A | Run B |
| --- | ---: | ---: |
| Fast path `GET /users` (Techne) | {fmt_rps(r['fast_users']['rps'])} req/s | {fmt_rps(r_b['fast_users']['rps'])} req/s |
| Native ceiling, same endpoint | {fmt_rps(r['native_users']['rps'])} req/s | {fmt_rps(r_b['native_users']['rps'])} req/s |
| In-process gap | {fast_gap_a:.2f}× | {fast_gap_b:.2f}× |
| Loopback `GET /users` (Techne) | {fmt_rps(r['sock_users']['rps'])} req/s | {fmt_rps(r_b['sock_users']['rps'])} req/s |
| Loopback gap vs native | {sock_gap_a:.2f}× | {sock_gap_b:.2f}× |
| Cold start, N=1 → first request | {r['cold_1']['avgUs'] / 1000:.1f} ms | {r_b['cold_1']['avgUs'] / 1000:.1f} ms |
| Cold start, N=50 → first request | {r['cold_50']['avgUs'] / 1000:.1f} ms | {r_b['cold_50']['avgUs'] / 1000:.1f} ms |
| Memory at 500 routes (post-boot RSS) | {mem_a[500]['afterBoot']['rssBytes'] / 1048576:.1f} MB | {mem_b[500]['afterBoot']['rssBytes'] / 1048576:.1f} MB |
| DI warm lookup | {r['di_top_warm']['avgUs']:.2f} µs | {r_b['di_top_warm']['avgUs']:.2f} µs |
| HTTP client overhead | {r['client_bare']['avgUs']:.2f}–{r['client_query']['avgUs']:.2f} µs/call | {r_b['client_bare']['avgUs']:.2f}–{r_b['client_query']['avgUs']:.2f} µs/call |
| Rows vs baseline (≥10% move) | {comp_a['improvements']} up / {comp_a['regressions']} down | {comp_b['improvements']} up / {comp_b['regressions']} down |

The headline is the one the suite was built to expose: across both routes and
both runs the in-process gap is roughly
**{min(fast_gap_a, fast_gap_id_a, fast_gap_b, fast_gap_id_b):.1f}–{max(fast_gap_a, fast_gap_id_a, fast_gap_b, fast_gap_id_b):.1f}×**,
but over real loopback TCP it collapses to
**{min(sock_gap_a, sock_gap_id_a, sock_gap_b, sock_gap_id_b):.2f}–{max(sock_gap_a, sock_gap_id_a, sock_gap_b, sock_gap_id_b):.2f}×**.
Transport and `Bun.serve` dominate; the framework overhead users actually pay is
roughly 10–20%.

> **Baseline caveat.** `bench/baseline.json` was committed on **2026-08-04**
> (commit `97e2613`), before the native-API default (#73) and the HTTP-core
> rewrite (#75); it also does not record its Bun version. Percentages against it
> are cumulative across three months of changes, not a before/after for one PR.

## Environment

| Item | Value |
| --- | --- |
| Commit | `49f4668` (2026-11-04) |
| Machine | Apple M2, 8 cores, 8 GB RAM |
| OS | macOS 26.6.2 (arm64) |
| Runtime | Bun 1.4.4 |
| Run mode | `full` — 50,000 requests/iteration, 5 iterations, drop high/low |
| Runs captured | Two consecutive full runs: A (`2026-11-05.json`), B (`2026-11-05-b.json`) |

The baseline does not record machine or runtime metadata, so it cannot be proven
to be like-for-like. Treat cross-baseline percentages as directional.

## Methodology

The matrix in `benchmarks/` exercises the request pipeline with `app.handle()` in
process — no sockets, no kernel scheduling — except for the explicit loopback
scenario.

- **HTTP scenarios:** 50,000 requests per iteration, issued in concurrent batches
  of 100; five measured iterations, highest and lowest dropped, middle three
  averaged.
- **Stabilization:** `Bun.gc(true)` plus a 50 ms yield before measurement so a
  stop-the-world GC does not land inside the timing window.
- **Socket scenario:** 20,000 requests per iteration, batch width 50, over real
  loopback TCP through `Bun.serve`.
- **Cold start:** three fresh `bun` processes per feature count (N = 1, 10, 50);
  measured from process start to first served request.
- **In-process cold start:** 20 `TechneFactory.create()` boots per N, GC between
  runs.
- **Memory:** one child process per route count (1, 10, 50, 200, 500); RSS
  sampled after boot and after 20,000 in-process requests.
- **Regression gate:** 10% threshold; rows with fewer than 10 samples are
  reported but never fail the build.

Two back-to-back runs of identical code establish today's noise floor:

| Check | Result |
| --- | ---: |
| Matched rows | {nz['matched']} |
| Median absolute change | {nz['median'] * 100:.1f}% |
| p90 absolute change | {nz['p90'] * 100:.1f}% |
| Largest absolute change | {nz['max'] * 100:.1f}% |
| Rows moving > 10% | {nz['over10']} |
| Rows moving > 25% | {nz['over25']} |

Run B was **{nz['geo'] * 100:+.1f}%** faster than run A geometrically,
confirming a systematic warm-up/order bias. Single-run values below should be
read with at least a ±10% band; this is why the suite gates at 10% rather than
5%.

Rows that moved more than 10% between the two identical-code runs:

{nz['table']}

## Current results (run A)

{cold_start_note}

{render_results(a)}

### Memory & route scaling

{render_memory(a)}

Run B reproduced the same shape: {mem_b[1]['afterBoot']['rssBytes'] / 1048576:.1f} MB
at 1 route, {mem_b[500]['afterBoot']['rssBytes'] / 1048576:.1f} MB at 500,
{mem_b[500]['perRouteKb']:.1f} KB marginal per route, and
{mem_b[500]['loadGrowthMb']:.1f} MB load-phase growth at 500 routes.

## Baseline comparison

Matched rows only; renamed rows are covered below. Deltas within ±10% render as
`≈`.

{comp_table}

**Run A summary:** {comp_a['matched']} matched rows, geometric mean
**{comp_a['geomean'] * 100:+.1f}%**, {comp_a['improvements']} improvements,
{comp_a['regressions']} regressions, {comp_a['noise']} within the noise band.

**Run B summary:** {comp_b['matched']} matched rows, geometric mean
**{comp_b['geomean'] * 100:+.1f}%**, {comp_b['improvements']} improvements,
{comp_b['regressions']} regressions, {comp_b['noise']} within the noise band —
both "regressions" are the single-sample cold-DI probes, so **no gated row
regressed in run B**.

### Renamed native rows

The native app was benchmarked as `Elysia (...)` in the baseline and is
`Native (...)` now. Across that rename:

{native_table}

## Analysis

### Request pipeline

- **Fast path:** Techne serves `GET /users` at
  {fmt_rps(r['fast_users']['rps'])} req/s in run A and
  {fmt_rps(r_b['fast_users']['rps'])} in run B, against a native ceiling of
  {fmt_rps(r['native_users']['rps'])} / {fmt_rps(r_b['native_users']['rps'])}.
  That is a **{fast_gap_a:.2f}–{fast_gap_b:.2f}×** in-process gap. The
  parameterised route is noisier — {fmt_rps(r['fast_id']['rps'])} /
  {fmt_rps(r_b['fast_id']['rps'])} req/s for Techne, with a
  {min(fast_gap_id_a, fast_gap_id_b):.2f}–{max(fast_gap_id_a, fast_gap_id_b):.2f}×
  gap — because the native row itself moved
  {nz['by_key'][K['native_id']] * 100:+.1f}% between runs.
- **Slow path (static guard):** {fmt_rps(r['slow_users']['rps'])} req/s in run A
  ({(slow_ratio_a - 1) * 100:+.1f}% vs the unguarded fast path) and
  {fmt_rps(r_b['slow_users']['rps'])} in run B ({(slow_ratio_b - 1) * 100:+.1f}%).
  The sign flips between runs, so the always-allow static guard adds **no
  measurable per-request tax**; it is effectively hoisted at registration.
- **Validation:** invalid bodies run at
  {fmt_rps(r['invalid']['rps'])} req/s vs {fmt_rps(r['valid']['rps'])} for valid
  ones in run A ({(invalid_ratio_a - 1) * 100:+.1f}%), and
  {fmt_rps(r_b['invalid']['rps'])} vs {fmt_rps(r_b['valid']['rps'])} in run B
  ({(invalid_ratio_b - 1) * 100:+.1f}%). Error construction costs roughly a
  quarter to a third of the happy path — real, but not pathological.
- **Response schema:** the typed route is
  {fmt_rps(r['typed']['rps'])} req/s vs {fmt_rps(r['plain']['rps'])} for plain
  JSON in run A ({(schema_ratio_a - 1) * 100:+.1f}%), but
  {fmt_rps(r_b['typed']['rps'])} vs {fmt_rps(r_b['plain']['rps'])} in run B
  ({(schema_ratio_b - 1) * 100:+.1f}%). One run trips the scenario's 95%
  heuristic, the other does not. **This is unresolved, not a confirmed
  regression** — re-measure with more iterations before investigating the
  stringifier.
- **CORS:** {fmt_rps(r['cors_allow']['rps'])} req/s for an allow-list origin and
  {fmt_rps(r['cors_echo']['rps'])} req/s for a reflected origin — effectively
  identical, so the per-origin header cache is doing its job.

### Transport reality check

| Route | Native (socket), A / B | Techne (socket), A / B | Gap, A / B |
| --- | ---: | ---: | ---: |
| `GET /users` | {fmt_rps(r['sock_native_users']['rps'])} / {fmt_rps(r_b['sock_native_users']['rps'])} | {fmt_rps(r['sock_users']['rps'])} / {fmt_rps(r_b['sock_users']['rps'])} | {sock_gap_a:.2f}× / {sock_gap_b:.2f}× |
| `GET /users/:id` | {fmt_rps(r['sock_native_id']['rps'])} / {fmt_rps(r_b['sock_native_id']['rps'])} | {fmt_rps(r['sock_id']['rps'])} / {fmt_rps(r_b['sock_id']['rps'])} | {sock_gap_id_a:.2f}× / {sock_gap_id_b:.2f}× |

For `GET /users`, the in-process gap is {fast_gap_a:.2f}× and {fast_gap_b:.2f}×;
on a real socket it is {sock_gap_a:.2f}× and {sock_gap_b:.2f}×. For
`GET /users/:id` the corresponding gaps are {fast_gap_id_a:.2f}× /
{fast_gap_id_b:.2f}× in-process and {sock_gap_id_a:.2f}× / {sock_gap_id_b:.2f}×
on-socket. For this workload, further micro-optimisation of the in-process path
buys the user very little: transport and `Bun.serve` dominate. The remaining
on-socket overhead — roughly
{sock_gap_a * 100 - 100:.0f}–{sock_gap_id_a * 100 - 100:.0f}% in run A and
{sock_gap_b * 100 - 100:.0f}–{sock_gap_id_b * 100 - 100:.0f}% in run B — is the
number to defend in production.

### Runtime

- **DI warm:** {fmt_rps(r['di_top_warm']['rps'])} req/s in run A and
  {fmt_rps(r_b['di_top_warm']['rps'])} in run B for `TopLevelService`; ~0.03–0.04 µs
  per lookup in both runs, consistent with a single Map hit. No cache regression.
- **Cold DI:** the first resolution of `TopLevelService` costs
  {r['di_top_cold']['avgUs']:.1f} µs in run A ({r_b['di_top_cold']['avgUs']:.1f} µs
  in run B); `DependencyA` costs {r['di_dep_cold']['avgUs']:.2f} µs
  ({r_b['di_dep_cold']['avgUs']:.2f} µs). These rows are **single samples**
  (`total = 1`) and are excluded from the regression gate by design.
- **Cold start (process spawn):** {r['cold_1']['avgUs'] / 1000:.1f} ms at N=1,
  {r['cold_10']['avgUs'] / 1000:.1f} ms at N=10, and
  {r['cold_50']['avgUs'] / 1000:.1f} ms at N=50 in run A; run B is faster at
  {r_b['cold_1']['avgUs'] / 1000:.1f}, {r_b['cold_10']['avgUs'] / 1000:.1f}, and
  {r_b['cold_50']['avgUs'] / 1000:.1f} ms. Fifty feature modules add only ~1 ms
  to time-to-first-request; the curve is close to flat relative to process
  startup.
- **Cold start (in-process):** {r['ip_1']['avgUs'] / 1000:.2f} ms at N=1,
  {r['ip_10']['avgUs'] / 1000:.2f} ms at N=10, and {r['ip_50']['avgUs'] / 1000:.2f}
  ms at N=50 in run A ({r_b['ip_1']['avgUs'] / 1000:.2f}, {r_b['ip_10']['avgUs'] / 1000:.2f},
  {r_b['ip_50']['avgUs'] / 1000:.2f} ms in run B). The framework's own boot cost
  is sub-millisecond; most of the end-to-end number is Bun startup and
  TypeScript transform.

### Outgoing HTTP client

| Case | req/s (A / B) | avg µs (A / B) | p99 µs (A) |
| --- | ---: | ---: | ---: |
| GET (bare) | {fmt_rps(r['client_bare']['rps'])} / {fmt_rps(r_b['client_bare']['rps'])} | {r['client_bare']['avgUs']:.2f} / {r_b['client_bare']['avgUs']:.2f} | {r['client_bare']['p99Us']:.2f} |
| GET (query + headers) | {fmt_rps(r['client_query']['rps'])} / {fmt_rps(r_b['client_query']['rps'])} | {r['client_query']['avgUs']:.2f} / {r_b['client_query']['avgUs']:.2f} | {r['client_query']['p99Us']:.2f} |
| POST (json body) | {fmt_rps(r['client_post']['rps'])} / {fmt_rps(r_b['client_post']['rps'])} | {r['client_post']['avgUs']:.2f} / {r_b['client_post']['avgUs']:.2f} | {r['client_post']['p99Us']:.2f} |
| POST (token + json) | {fmt_rps(r['client_token']['rps'])} / {fmt_rps(r_b['client_token']['rps'])} | {r['client_token']['avgUs']:.2f} / {r_b['client_token']['avgUs']:.2f} | {r['client_token']['p99Us']:.2f} |

This measures only client-side overhead — URL assembly, header merging, body
encoding, middleware, response buffering — against a stub transport. At roughly
1.2–2.0 µs per call it is negligible next to any real network hop.

### Memory

- RSS grows from {mem_a[1]['afterBoot']['rssBytes'] / 1048576:.1f} MB at one
  route to {mem_a[500]['afterBoot']['rssBytes'] / 1048576:.1f} MB at 500 in run A
  ({mem_b[1]['afterBoot']['rssBytes'] / 1048576:.1f} → {mem_b[500]['afterBoot']['rssBytes'] / 1048576:.1f} MB
  in run B).
- Marginal cost falls from {mem_a[10]['perRouteKb']:.1f} KB/route at 10 routes to
  {mem_a[500]['perRouteKb']:.1f} KB/route at 500, as fixed runtime costs
  amortize.
- Boot time scales from {mem_a[1]['bootMs']:.1f} ms to
  {mem_a[500]['bootMs']:.1f} ms at 500 routes — roughly
  {mem_a[500]['bootMs'] / mem_a[1]['bootMs']:.1f}× for 500× the routes.
- Load-phase growth is {mem_a[500]['loadGrowthMb']:.1f} MB at 500 routes versus
  {mem_a[1]['loadGrowthMb']:.1f} MB at one route; it does **not** widen with
  route count, so there is no per-route retention signal in this run.
- Cross-run memory comparison against the August baseline is not meaningful: it
  recorded ~72 MB at one route versus ~16 MB today, which reflects a different
  runtime/environment more than a framework change.

## Regressions and caveats

The three rows that fell more than 10% below the old baseline in run A:

{chr(10).join(regression_lines)}

The in-process N=50 row moved
**{nz['by_key'][K['ip_50']] * 100:+.1f}%** between run A and run B (2,653 →
3,307 req/s, now {ip50_vs_base_b * 100:+.1f}% versus baseline), so its 10.5% drop
versus the baseline does not reproduce. `bun run bench:check --current` confirms
the shape: **exit 1** on run A, solely because of that row; **exit 0** on run B
(0 gated regressions, 24 improvements). The two DI cold rows are single samples,
deliberately excluded from the gate, and can swing by tens of percent between
identical runs (DependencyA moved +40.2% from A to B).

Other caveats:

- The committed baseline predates #73/#75 and records no machine/runtime
  metadata; the geometric-mean gains are cumulative, not attributable to one
  change.
- Today's identical-code A/B moved {nz['over10']} of {nz['matched']} rows by more
  than 10% (median {nz['median'] * 100:.1f}%, p90 {nz['p90'] * 100:.1f}%). Any
  single-row conclusion smaller than that is not actionable.
- **End-to-end `oha` harness not run:** `apps/demo/perf` requires the `oha`
  binary, which is not installed on this machine. This report covers the
  in-process matrix plus the real-loopback scenario; it does not include the
  demo app's multi-endpoint `oha` run.

## Recommendations

1. **Re-capture the baseline on this commit and Bun 1.4.4**, storing environment
   metadata (`bun --version`, machine, commit) in the baseline JSON. The current
   baseline is three months old and cannot gate day-to-day changes meaningfully.
2. **Re-measure the response-schema route with more iterations.** Run A was 24%
   slower than plain JSON; run B was only 5% slower. That is not enough evidence
   to chase the stringifier, but it is close enough to keep on the watch list.
3. **Use the on-socket number as the production KPI.** The 10–20% gap over real
   TCP is the overhead users pay; the 2–3× in-process gap overstates it.
4. **Run the `oha` end-to-end harness** (`brew install oha`, then
   `bun run --cwd apps/demo perf`) to cover the demo app's real routes, JWT
   guard, and validated POST path.
5. **Benchmark on an otherwise idle machine** before acting on a single result.
   Today's A/B noise is wider than the 10% gate; consider raising per-scenario
   iterations or using the median of three runs for release decisions.

## Reproducibility

```sh
# Full matrix (this report's primary data)
bun run benchmarks/index.ts --json > bench/runs/2026-11-05.json

# Human-readable tables
bun run benchmarks/index.ts

# Regression gate against the committed baseline
bun run bench:check

# Compare a captured run against the baseline
bun run benchmarks/compare.ts bench/baseline.json bench/runs/2026-11-05.json \\
  --labels "baseline,current" --threshold 0.1
```

Artifacts:

- `bench/runs/2026-11-05.json` — primary run (A)
- `bench/runs/2026-11-05-b.json` — repeat run (B, noise check)
- `bench/runs/2026-11-05-compare.md` — raw baseline comparison
- `bench/runs/2026-11-05-ab.md` — raw A/B noise comparison
- `bench/runs/2026-11-05-check.md` — gate output for run A (exit 1)
- `bench/runs/2026-11-05-b-check.md` — gate output for run B (exit 0)
- `bench/baseline.json` — committed baseline (2026-08-04, `97e2613`)
- `bench/reports/2026-11-05.md` — this report
"""

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(report)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
