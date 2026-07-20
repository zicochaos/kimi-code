import { describe, expect, it } from 'vitest';
import {
  freezeDefaultModelForDisk,
  isDefaultModelOnlyPatch,
  shouldPersistDefaultModel,
} from '../../src/config/persist-default-model';
import type { KimiConfig } from '../../src/config/schema';

const base = {
  providers: {},
  defaultModel: 'disk-model',
  thinking: { enabled: true, effort: 'high' },
  persistDefaultModel: false,
} as KimiConfig;

describe('shouldPersistDefaultModel', () => {
  it('defaults to true when the key is absent', () => {
    expect(shouldPersistDefaultModel({} as KimiConfig)).toBe(true);
  });
  it('is true when explicitly true', () => {
    expect(shouldPersistDefaultModel({ persistDefaultModel: true } as KimiConfig)).toBe(true);
  });
  it('is false only when explicitly false', () => {
    expect(shouldPersistDefaultModel({ persistDefaultModel: false } as KimiConfig)).toBe(false);
  });
});

describe('isDefaultModelOnlyPatch', () => {
  it('accepts defaultModel and/or thinking only', () => {
    expect(isDefaultModelOnlyPatch({ defaultModel: 'x' })).toBe(true);
    expect(isDefaultModelOnlyPatch({ thinking: { enabled: false } })).toBe(true);
    expect(isDefaultModelOnlyPatch({ defaultModel: 'x', thinking: { effort: 'low' } })).toBe(true);
  });
  it('rejects patches that touch any other key', () => {
    expect(isDefaultModelOnlyPatch({ defaultModel: 'x', models: {} })).toBe(false);
    expect(isDefaultModelOnlyPatch({ providers: {} })).toBe(false);
    expect(isDefaultModelOnlyPatch({})).toBe(false);
  });
});

describe('freezeDefaultModelForDisk', () => {
  it('restores defaultModel and thinking from disk when flag is false', () => {
    const runtime = {
      ...base,
      defaultModel: 'session-model',
      thinking: { enabled: false, effort: 'low' },
      models: { 'session-model': { provider: 'p', model: 'm', maxContextSize: 1 } },
    } as KimiConfig;
    const frozen = freezeDefaultModelForDisk(runtime, base);
    expect(frozen.defaultModel).toBe('disk-model');
    expect(frozen.thinking).toEqual({ enabled: true, effort: 'high' });
    expect(frozen.models).toEqual(runtime.models);
  });
  it('is a no-op when flag is true/absent', () => {
    const runtime = { ...base, persistDefaultModel: true, defaultModel: 'session-model' } as KimiConfig;
    const disk = { ...base, persistDefaultModel: true } as KimiConfig;
    expect(freezeDefaultModelForDisk(runtime, disk).defaultModel).toBe('session-model');
  });
});
