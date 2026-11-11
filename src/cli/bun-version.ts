/**
 * Reproducible build inputs. Keep these in sync with `.bun-version`,
 * `package.json` engines, the Docker generator default and CI.
 */
export const DEFAULT_BUN_VERSION = "1.4.4";

/**
 * Exact canary used for the AOT preview job. Bun reports `1.4.4` from
 * `bun --version` even on canary builds, so record `bun --revision` too.
 */
export const AOT_PREVIEW_BUN_VERSION = "1.4.4-canary.20261109.1";

/** Docker Hub tag used by the AOT Dockerfile when no version is supplied. */
export const AOT_PREVIEW_DOCKER_TAG = "canary";
