import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { mergeConfigPatch } from '../../src/config/merge';
import {
  freezeDefaultModelForDisk,
  isDefaultModelOnlyPatch,
  planConfigWrite,
  shouldPersistDefaultModel,
} from '../../src/config/persist-default-model';
import type { KimiConfig } from '../../src/config/schema';
import { readConfigFile, writeConfigFile } from '../../src/config/toml';

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

describe('planConfigWrite', () => {
  it('skips write for model-only patches when flag is false', () => {
    const disk = { ...base } as KimiConfig;
    const patch = { defaultModel: 'session-model', thinking: { effort: 'low' as const } };
    const merged = { ...disk, ...patch } as KimiConfig;
    expect(planConfigWrite({ disk, patch, merged })).toEqual({ write: false });
  });

  it('freezes defaultModel for non-model writes when flag is false', () => {
    const disk = { ...base } as KimiConfig;
    const patch = {
      defaultModel: 'session-model',
      models: {
        'session-model': { provider: 'p', model: 'session', maxContextSize: 1000 },
      },
    };
    const merged = {
      ...disk,
      defaultModel: 'session-model',
      models: patch.models,
    } as KimiConfig;
    const plan = planConfigWrite({ disk, patch, merged });
    expect(plan.write).toBe(true);
    if (!plan.write) throw new Error('expected write');
    expect(plan.configForDisk.defaultModel).toBe('disk-model');
    expect(plan.configForDisk.thinking).toEqual(disk.thinking);
    expect(plan.configForDisk.models).toEqual(patch.models);
  });

  it('writes merged config when flag is true/absent', () => {
    const disk = { ...base, persistDefaultModel: true } as KimiConfig;
    const patch = { defaultModel: 'session-model' };
    const merged = { ...disk, defaultModel: 'session-model' } as KimiConfig;
    expect(planConfigWrite({ disk, patch, merged })).toEqual({
      write: true,
      configForDisk: merged,
    });
  });

  it('writes merged config for model-only patches when flag is true', () => {
    const disk = { ...base, persistDefaultModel: undefined } as KimiConfig;
    const patch = { defaultModel: 'session-model', thinking: { effort: 'low' as const } };
    const merged = { ...disk, ...patch } as KimiConfig;
    expect(planConfigWrite({ disk, patch, merged })).toEqual({
      write: true,
      configForDisk: merged,
    });
  });
});

describe('persist_default_model disk behavior', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempConfig(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'kimi-pdm-'));
    dirs.push(dir);
    const path = join(dir, 'config.toml');
    writeFileSync(path, body);
    return path;
  }

  it('model-only write with flag false leaves disk default_model unchanged', async () => {
    const path = tempConfig(`
persist_default_model = false
default_model = "disk-model"
[thinking]
effort = "high"
[providers.p]
type = "kimi"
api_key = "k"
[models.disk-model]
provider = "p"
model = "disk"
max_context_size = 1000
[models.session-model]
provider = "p"
model = "session"
max_context_size = 1000
`);
    const disk = readConfigFile(path);
    expect(shouldPersistDefaultModel(disk)).toBe(false);
    const patch = { defaultModel: 'session-model', thinking: { effort: 'low' as const } };
    expect(isDefaultModelOnlyPatch(patch)).toBe(true);
    const merged = mergeConfigPatch(disk, patch);
    const plan = planConfigWrite({ disk, patch, merged });
    expect(plan.write).toBe(false);
    // Simulate setKimiConfig session-only: do not write; runtime would use merged.
    expect(merged.defaultModel).toBe('session-model');
    const text = readFileSync(path, 'utf-8');
    expect(text).toContain('default_model = "disk-model"');
    // Model entry may exist in the fixture; only the default must stay frozen.
    expect(text).not.toMatch(/default_model\s*=\s*"session-model"/);
  });

  it('non-model write with flag false still persists other sections and freezes default_model', async () => {
    const path = tempConfig(`
persist_default_model = false
default_model = "disk-model"
[providers.p]
type = "kimi"
api_key = "k"
[models.disk-model]
provider = "p"
model = "disk"
max_context_size = 1000
`);
    const disk = readConfigFile(path);
    const merged = mergeConfigPatch(disk, {
      defaultModel: 'session-model',
      models: {
        'disk-model': disk.models!['disk-model']!,
        extra: { provider: 'p', model: 'extra', maxContextSize: 1000 },
      },
    });
    const forDisk = freezeDefaultModelForDisk(merged, disk);
    await writeConfigFile(path, forDisk);
    const onDisk = readConfigFile(path);
    expect(onDisk.defaultModel).toBe('disk-model');
    expect(onDisk.models?.['extra']).toBeDefined();
  });

  it('planConfigWrite freezes before writeConfigFile for mixed patches', async () => {
    const path = tempConfig(`
persist_default_model = false
default_model = "disk-model"
[thinking]
effort = "high"
[providers.p]
type = "kimi"
api_key = "k"
[models.disk-model]
provider = "p"
model = "disk"
max_context_size = 1000
`);
    const disk = readConfigFile(path);
    const patch = {
      defaultModel: 'session-model',
      thinking: { effort: 'low' as const },
      models: {
        'disk-model': disk.models!['disk-model']!,
        extra: { provider: 'p', model: 'extra', maxContextSize: 1000 },
      },
    };
    const merged = mergeConfigPatch(disk, patch);
    const plan = planConfigWrite({ disk, patch, merged });
    expect(plan.write).toBe(true);
    if (!plan.write) throw new Error('expected write');
    await writeConfigFile(path, plan.configForDisk);
    const onDisk = readConfigFile(path);
    expect(onDisk.defaultModel).toBe('disk-model');
    expect(onDisk.thinking?.effort).toBe('high');
    expect(onDisk.models?.['extra']).toBeDefined();
  });
});
