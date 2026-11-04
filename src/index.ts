/** Elysia-native composition. This entrypoint must never import the legacy runtime. */
export { createApp } from "./runtime/create-app";
export { createResources } from "./runtime/create-resources";
export type { Cleanup, OnClose, Resources } from "./runtime/create-resources";
export { Elysia, t, status, problem } from "./vendor/elysia/index";
export type { AnyElysia, Context, Problem } from "./vendor/elysia/index";
export type { ElysiaConfig } from "./vendor/elysia/types";
