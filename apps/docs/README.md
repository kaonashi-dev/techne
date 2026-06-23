# Techne docs

[Mintlify](https://mintlify.com) site for
[@kaonashi-dev/techne](https://github.com/kaonashi-dev/techne).

## Local development

```bash
bun install
bun run dev      # → http://localhost:3000
```

`bun run dev` runs `mintlify dev`. The first run downloads the Mintlify CLI.

## Authoring

- Pages are `.mdx` files grouped into topic folders (`http/`, `mq/`, `cli/`, …).
- Navigation, theme, colors, logo, and anchors live in
  [`docs.json`](./docs.json) — the single source of truth for site config.
- To add a page: create the `.mdx` file under the matching folder and register
  its path (without the extension) in the relevant `group` in `docs.json`.
- Each page starts with a `title` / `description` frontmatter block and may use
  [Mintlify components](https://mintlify.com/docs/components) such as `<Note>`,
  `<Card>`, `<Steps>`, `<Tabs>`, and `<CodeGroup>`.

## Checks

Validate internal links before opening a PR:

```bash
bun run broken-links
```
