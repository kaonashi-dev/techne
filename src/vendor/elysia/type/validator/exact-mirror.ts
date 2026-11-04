import createExactMirror from '../../../exact-mirror/index'

export type CreateMirror = (schema: any, options?: any) => any

let exactMirror: CreateMirror | undefined = createExactMirror

export const getExactMirror = () => exactMirror

// Internal registration hook for non-Node runtimes and tests.
export const setExactMirror = (mirror: CreateMirror | undefined) =>
	(exactMirror = mirror)

export const exactMirrorRequired = () =>
	new Error(
		"exact-mirror is required when using normalize: 'exactMirror' or sanitize. Install it and, if the runtime cannot load CommonJS modules, register it with setupTypebox({ exactMirror }); otherwise use normalize: 'typebox'."
	)
