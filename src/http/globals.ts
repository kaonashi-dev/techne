import type { RequestMiddlewareFn, ResponseMiddlewareFn } from "./types";

export const _globalRequestMiddleware: RequestMiddlewareFn[] = [];
export const _globalResponseMiddleware: ResponseMiddlewareFn[] = [];
export let _globalRequestInit: RequestInit = {};

export function _setGlobalOptions(init: RequestInit): void {
  _globalRequestInit = { ..._globalRequestInit, ...init };
}

export function _resetGlobals(): void {
  _globalRequestMiddleware.length = 0;
  _globalResponseMiddleware.length = 0;
  _globalRequestInit = {};
}
