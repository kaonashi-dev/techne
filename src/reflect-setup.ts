/**
 * Patches the global `Reflect` object with the three methods that
 * `reflect-metadata` normally provides:
 *
 *   - Reflect.metadata(key, value)      ← emitted by TypeScript (emitDecoratorMetadata)
 *   - Reflect.defineMetadata(key, v, t)  ← used by framework decorators
 *   - Reflect.getMetadata(key, target)   ← used by container / scanner
 *
 * Import this file once at the earliest point in the process (it is already
 * imported transitively through every decorator file).  Subsequent imports
 * are no-ops thanks to module caching.
 */
import { defineMetadata, getMetadata, metadata } from "./core/metadata-store";

const R = Reflect as any;

if (!R.metadata) R.metadata = metadata;
if (!R.defineMetadata) R.defineMetadata = defineMetadata;
if (!R.getMetadata) R.getMetadata = getMetadata;
