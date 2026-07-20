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
