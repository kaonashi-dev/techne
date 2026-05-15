# Techne docs

Mintlify site for [@kaonashi-dev/techne](https://github.com/kaonashi-dev/techne).

```bash
bun install
bunx mintlify dev
```

The dev server boots on `http://localhost:3000`. Navigation, theme, and anchors
live in [`mint.json`](./mint.json); add new pages by creating an MDX file under
the matching topic folder and registering it there.

To check for broken internal links:

```bash
bunx mintlify broken-links
```
