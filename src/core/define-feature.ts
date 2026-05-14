export interface Feature {
  /** Optional name for debugging/logging. */
  name?: string;
  controllers?: any[];
  providers?: any[];
}

/**
 * Defines a feature as a plain object — no class decorator, no registration.
 * Features are passed to `TechneFactory.create({ features: [...] })` and
 * flattened into the container at boot time.
 */
export function defineFeature(config: Feature): Feature {
  return config;
}
