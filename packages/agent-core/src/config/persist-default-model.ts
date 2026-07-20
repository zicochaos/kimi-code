import type { KimiConfig, KimiConfigPatch } from './schema';

const MODEL_SWITCH_KEYS = new Set(['defaultModel', 'thinking']);

export function shouldPersistDefaultModel(
  config: Pick<KimiConfig, 'persistDefaultModel'>,
): boolean {
  return config.persistDefaultModel !== false;
}

export function isDefaultModelOnlyPatch(patch: KimiConfigPatch): boolean {
  const keys = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined);
  if (keys.length === 0) return false;
  return keys.every((key) => MODEL_SWITCH_KEYS.has(key));
}

export function freezeDefaultModelForDisk(runtime: KimiConfig, disk: KimiConfig): KimiConfig {
  if (shouldPersistDefaultModel(runtime) && shouldPersistDefaultModel(disk)) {
    return runtime;
  }
  return {
    ...runtime,
    defaultModel: disk.defaultModel,
    thinking: disk.thinking,
  };
}

/**
 * Decide whether a setKimiConfig call should touch disk, and if so what to write.
 * Persistence is decided from the **merged** (effective) config after the patch.
 * Freeze source for defaultModel/thinking remains the **disk** snapshot.
 *
 * When effective `persist_default_model = false`, model-only switches stay session-only;
 * other writes still go to disk with defaultModel/thinking frozen to disk values.
 * Pure flag toggles (and mixed flag+model patches) always write.
 */
export function planConfigWrite(args: {
  disk: KimiConfig;
  patch: KimiConfigPatch;
  merged: KimiConfig;
}): { write: false } | { write: true; configForDisk: KimiConfig } {
  const persist = shouldPersistDefaultModel(args.merged);
  if (!persist && isDefaultModelOnlyPatch(args.patch)) {
    return { write: false };
  }
  if (!persist) {
    return { write: true, configForDisk: freezeDefaultModelForDisk(args.merged, args.disk) };
  }
  return { write: true, configForDisk: args.merged };
}
