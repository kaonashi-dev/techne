/** Elysia-native composition. This entrypoint must never import the legacy runtime. */
export { createApp } from "./runtime/create-app";
export { createResources } from "./runtime/create-resources";
export type { Cleanup, OnClose, Resources } from "./runtime/create-resources";
export { Elysia, t, status, problem } from "elysia";
export type { AnyElysia, Context, Problem } from "elysia";
export type { ElysiaConfig } from "elysia/types";
