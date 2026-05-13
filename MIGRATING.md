# Migrating from Bnest to Techne

Techne v0.4.0 is the same framework as Bnest v0.3.0 — only the brand,
package name, CLI bin, and a few defaults changed. Most user code works
unmodified through the 0.4.x line because the previous names live on as
`@deprecated` re-export aliases. The pieces that genuinely break are
called out below with explicit recipes.

Plan to upgrade in this order: install the new package, rename your
config file, update Redis prefixes (if you use the Redis adapters),
then mop up the optional cosmetic renames at your leisure.

## 1. Install the new package

```bash
bun remove @kaonashi-dev/bnest
bun add @kaonashi-dev/techne
```

The legacy `@kaonashi-dev/bnest@0.4.0` is published as a thin shim that
re-exports everything from `@kaonashi-dev/techne` and prints a one-time
deprecation warning. You can install it temporarily during a multi-step
migration, but it is deprecated and will not receive further updates.

## 2. Update imports (optional but encouraged)

Search-replace at your leisure — the legacy paths keep working through
0.4.x via the shim:

```diff
-import { BnestFactory } from "@kaonashi-dev/bnest/core";
+import { TechneFactory } from "@kaonashi-dev/techne/core";

-import { Controller, Module } from "@kaonashi-dev/bnest/common";
+import { Controller, Module } from "@kaonashi-dev/techne/common";
```

Renames at a glance:

| Bnest (deprecated)              | Techne (canonical)                 |
| ------------------------------- | ---------------------------------- |
| `BnestFactory`                  | `TechneFactory`                    |
| `BnestApplication`              | `TechneApplication`                |
| `BnestApplicationContext`       | `TechneApplicationContext`         |
| `BnestApplicationOptions`       | `TechneApplicationOptions`         |
| `BnestHealthOptions`            | `TechneHealthOptions`              |
| `BnestShutdownOptions`          | `TechneShutdownOptions`            |
| `BnestInterceptor`              | `TechneInterceptor`                |
| `BnestMicroservice`             | `TechneMicroservice`               |
| `BnestConfig`                   | `TechneConfig`                     |
| `defineBnestConfig`             | `defineTechneConfig`               |
| `loadBnestConfigFile`           | `loadTechneConfigFile`             |
| `__resetBnestConfigCache`       | `__resetTechneConfigCache`         |
| `bnest()` shorthand             | `techne()`                         |
| `bootstrap()`                   | `bootstrap()` *(unchanged)*        |

All legacy names emit no warning by default — they simply re-export the
canonical implementation. They are scheduled for removal in **v0.5+**.

## 3. Rename the config file

```bash
mv bnest.config.ts techne.config.ts
```

Inside the file, rename the helper:

```diff
-import { defineBnestConfig } from "@kaonashi-dev/bnest/core";
+import { defineTechneConfig } from "@kaonashi-dev/techne/core";

-export default defineBnestConfig({
+export default defineTechneConfig({
   module: AppModule,
   port: 3000,
 });
```

The framework still loads `bnest.config.ts` if it finds it (and prints a
one-time warning telling you to rename), so this step can wait, but
`techne.config.ts` is preferred and will be the only recognised name in
v0.5+.

## 4. Update the CLI command

The `bnest` binary still works through the shim package, but the
canonical command is now `techne`:

```diff
-bnest dev
+techne dev

-bnest g controller users
+techne g controller users
```

The shim's `bnest <cmd>` forwards to `techne <cmd>` and prints a
deprecation banner.

## 5. Redis prefix migration **(breaking, read carefully)**

The three Redis-backed adapters changed their default key prefixes:

| Adapter            | Old default | New default  |
| ------------------ | ----------- | ------------ |
| MQ                 | `bnest:mq`  | `techne:mq`  |
| Queue              | `bnest:queue` | `techne:queue` |
| Microservices (pub/sub) | `bnest` | `techne`  |

**If you have running services with in-flight jobs or messages stored
under the old prefixes, you must rename those keys before upgrading.**
Without migration, the new code will not see the old keys and pending
work will go silently invisible until you scan them manually.

### Migration recipe

Run against your production Redis **before** rolling out 0.4.0. Repeat
for each affected pattern.

```bash
# Queue keys
redis-cli --scan --pattern 'bnest:queue:*' | while read k; do
  redis-cli RENAME "$k" "$(echo $k | sed 's/^bnest:/techne:/')"
done

# MQ keys
redis-cli --scan --pattern 'bnest:mq:*' | while read k; do
  redis-cli RENAME "$k" "$(echo $k | sed 's/^bnest:/techne:/')"
done

# Microservices pub/sub keys
redis-cli --scan --pattern 'bnest:*' | grep -v '^bnest:queue:' | grep -v '^bnest:mq:' | while read k; do
  redis-cli RENAME "$k" "$(echo $k | sed 's/^bnest:/techne:/')"
done
```

### Or pin the old prefix explicitly

If you'd rather not migrate keys right away, pass the old prefix on the
connection options and the adapter will keep using it:

```ts
new Queue("emails", { connection: { prefix: "bnest:queue" } });
new RedisDriver({ connection: { prefix: "bnest:mq" } });
```

Doing so will continue working but pins you to the legacy naming and
delays a future migration.

## 6. RFC 7807 problem document `type` URL **(breaking for clients)**

Error responses now emit:

```diff
-"type": "https://bnest.dev/errors/not-found"
+"type": "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/not-found.md"
```

If you have client code matching on the old `bnest.dev` URL host (e.g.
for translating problem documents into UI errors), update the matcher:

```diff
-/^https:\/\/bnest\.dev\/errors\/([a-z-]+)$/
+/^https:\/\/github\.com\/kaonashi-dev\/techne\/blob\/main\/docs\/errors\/([a-z-]+)\.md$/
```

The slugs themselves (`not-found`, `bad-request`, etc.) are unchanged.

## 7. Logger output format

If you scrape Techne logs:

- The pretty-mode prefix is now `[Techne]` (was `[Bnest]`).
- The JSON-mode `name` field is now `"Techne"` (was `"Bnest"`).
- The `[req=<uuid>]` per-request tag, level token, and context label are
  unchanged.

If your dashboards or alert rules pattern-match on the literal `Bnest`
string, swap them. If you use the JSON mode and parse the `name` field
as a key, swap it.

## 8. OpenAPI

- Default `info.title` is now `"Techne API"` (was `"Bnest API"`). If you
  set `title` on `DocumentBuilder` explicitly, you're unaffected.
- The diagnostic fallback marker for unknown TypeBox kinds renamed from
  `x-bnest-unknown-kind` to `x-techne-unknown-kind`. Only matters if you
  scrape spec output for it.

## 9. CLI doctor + generators

- `techne doctor` checks for `techne.config.ts` first, then falls back to
  `bnest.config.ts` and prints a yellow "deprecated" line. Functional
  behavior is unchanged.
- All new code generated by `techne g <kind>` uses `@kaonashi-dev/techne/*`
  imports and the `Techne*` class names. Files already in your repo are
  untouched until you regenerate them.

## 10. Verification checklist

After upgrading:

- [ ] `bun install` succeeds with `@kaonashi-dev/techne` listed and no
      `@kaonashi-dev/bnest` (unless you intentionally kept the shim).
- [ ] `bun test` (your suite) passes — both legacy and new identifiers
      should work.
- [ ] `bun run dev` starts and the first request returns a `Techne` log
      line.
- [ ] `/healthz` returns 200 and `/readyz` reports `{"status":"ready"}`
      after bootstrap.
- [ ] A 4xx response shows `Content-Type: application/problem+json` with
      the new `github.com/.../docs/errors/<slug>.md` `type` URL.
- [ ] Redis-backed queues/workers continue processing jobs (either via
      key migration in §5 or explicit prefix pinning).

## Reporting issues

If you hit something the guide misses, file an issue at
<https://github.com/kaonashi-dev/techne/issues> with the symptom and
your `package.json` version range. Migration friction is the whole
reason this doc exists — feedback that improves it is welcome.
