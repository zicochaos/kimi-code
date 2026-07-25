import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Emitter } from '../../src/base/common/event';
import type { KimiConfig } from '../../src/config';
import { KimiCore } from '../../src/rpc/core-impl';
import type { ICoreProcessService } from '../../src/services/coreProcess/coreProcess';
import type { IEventService } from '../../src/services/event/event';
import { ConfigService } from '../../src/services/config/configService';
import type { Event } from '@moonshot-ai/protocol';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeHome(configToml?: string): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
  tempDirs.push(home);
  if (configToml !== undefined) {
    await writeFile(path.join(home, 'config.toml'), configToml, 'utf-8');
  }
  return home;
}

function makeCore(home: string): KimiCore {
  return new KimiCore(async () => ({}) as never, { homeDir: home });
}

const VALID_TOML = `
default_model = "k2"

[providers.kimi]
type = "kimi"
api_key = "sk-good"

[models.k2]
provider = "kimi"
model = "kimi-for-coding"
max_context_size = 128000
`;

describe('KimiCore degraded config loading', () => {
  it('reports no diagnostics for a valid config', async () => {
    const core = makeCore(await makeHome(VALID_TOML));
    const config = await core.getKimiConfig({});
    expect(config.providers['kimi']).toBeDefined();
    await expect(core.getConfigDiagnostics({})).resolves.toEqual({ warnings: [] });
  });

  it('refuses to start when the TOML cannot be parsed at all', async () => {
    const home = await makeHome('[[[');
    // A fully unusable file means defaults-only (looks logged out), which is
    // worse than failing fast with the parse location.
    expect(() => makeCore(home)).toThrow(/Invalid TOML/);
  });

  it('starts with a partially invalid config, keeping the valid sections', async () => {
    const core = makeCore(
      await makeHome(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"
`),
    );
    const config = await core.getKimiConfig({});
    expect(config.providers['kimi']).toBeDefined();
    expect(config.loopControl).toBeUndefined();
    const diagnostics = await core.getConfigDiagnostics({});
    expect(diagnostics.warnings).toHaveLength(1);
    expect(diagnostics.warnings[0]).toContain('loop_control');
  });

  it('rejects config writes with an actionable error while the file is invalid', async () => {
    const home = await makeHome(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"
`);
    const core = makeCore(home);
    const before = await readFile(path.join(home, 'config.toml'), 'utf-8');

    // Write paths stay strict: changing settings on top of a broken file
    // must fail with a short, actionable message — not raw validation JSON —
    // and must leave the file untouched.
    const write = core.setKimiConfig({ thinking: { enabled: true } });
    await expect(write).rejects.toThrow(/fix it first/i);
    await expect(write).rejects.toThrow(/kimi doctor/);
    await expect(write).rejects.not.toThrow(/invalid_type/);

    const after = await readFile(path.join(home, 'config.toml'), 'utf-8');
    expect(after).toBe(before);
  });

  it('keeps the last good config when the file breaks mid-run', async () => {
    const home = await makeHome(VALID_TOML);
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');

    await writeFile(configPath, '[[[', 'utf-8');
    const kept = await core.getKimiConfig({ reload: true });
    expect(kept.providers['kimi']).toBeDefined();
    const degraded = await core.getConfigDiagnostics({});
    expect(degraded.warnings.some((w) => w.includes('Invalid TOML'))).toBe(true);
    expect(degraded.warnings.some((w) => w.includes('previous'))).toBe(true);

    await writeFile(configPath, `[thinking]\nenabled = true\n${VALID_TOML}`, 'utf-8');
    const adopted = await core.getKimiConfig({ reload: true });
    expect(adopted.thinking?.enabled).toBe(true);
    await expect(core.getConfigDiagnostics({})).resolves.toEqual({ warnings: [] });
  });
});

describe('KimiCore setKimiConfig persist_default_model', () => {
  const PDM_TOML = `
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
`;

  it('keeps model-only changes in process memory without writing disk', async () => {
    const home = await makeHome(PDM_TOML);
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');
    const before = await readFile(configPath, 'utf-8');

    const runtime = await core.setKimiConfig({
      defaultModel: 'session-model',
      thinking: { effort: 'low' },
    });

    expect(runtime.defaultModel).toBe('session-model');
    expect(runtime.thinking?.effort).toBe('low');
    expect(runtime.persistDefaultModel).toBe(false);
    expect(await readFile(configPath, 'utf-8')).toBe(before);
    await expect(core.getKimiConfig({ reload: true })).resolves.toMatchObject({
      defaultModel: 'session-model',
      thinking: { effort: 'low' },
    });
  });

  it('persists other fields while freezing the disk model and thinking', async () => {
    const home = await makeHome(PDM_TOML);
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');

    await core.setKimiConfig({ defaultModel: 'session-model', thinking: { effort: 'low' } });
    const runtime = await core.setKimiConfig({
      models: {
        'disk-model': { provider: 'p', model: 'disk', maxContextSize: 1000 },
        'session-model': { provider: 'p', model: 'session', maxContextSize: 1000 },
        extra: { provider: 'p', model: 'extra', maxContextSize: 1000 },
      },
    });

    expect(runtime.defaultModel).toBe('session-model');
    expect(runtime.thinking?.effort).toBe('low');
    expect(runtime.models?.['extra']).toBeDefined();
    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('default_model = "disk-model"');
    expect(text).toMatch(/effort\s*=\s*"high"/);
    expect(text).toMatch(/\[models\.extra\]/);
  });

  it('persists model-only changes when the flag is absent', async () => {
    const home = await makeHome(PDM_TOML.replace('persist_default_model = false\n', ''));
    const core = makeCore(home);

    await core.setKimiConfig({ defaultModel: 'session-model' });

    const text = await readFile(path.join(home, 'config.toml'), 'utf-8');
    expect(text).toContain('default_model = "session-model"');
  });

  it('can disable then re-enable persistence without losing the live model preference', async () => {
    const home = await makeHome(PDM_TOML.replace('persist_default_model = false', 'persist_default_model = true'));
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');

    const disabled = await core.setKimiConfig({
      persistDefaultModel: false,
      defaultModel: 'session-model',
    });
    expect(disabled).toMatchObject({ persistDefaultModel: false, defaultModel: 'session-model' });
    let text = await readFile(configPath, 'utf-8');
    expect(text).toContain('default_model = "disk-model"');

    const enabled = await core.setKimiConfig({ persistDefaultModel: true });
    expect(enabled).toMatchObject({ persistDefaultModel: true, defaultModel: 'session-model' });
    text = await readFile(configPath, 'utf-8');
    expect(text).toContain('default_model = "session-model"');
  });
});

describe('legacy ConfigService fork config projection', () => {
  it('retains fork config booleans in GET, POST, and config-changed events', async () => {
    const config = {
      providers: {},
      persistDefaultModel: false,
      agentsMdExpandIncludes: true,
    } as KimiConfig;
    const getKimiConfig = vi.fn(async () => config);
    const setKimiConfig = vi.fn(async (patch: Record<string, unknown>) => ({
      ...config,
      ...patch,
    }));
    const core = {
      _serviceBrand: undefined,
      rpc: { getKimiConfig, setKimiConfig } as unknown as ICoreProcessService['rpc'],
      ready: async () => {},
      dispose: () => {},
    } satisfies ICoreProcessService;
    const emitter = new Emitter<Event>();
    const events: Event[] = [];
    const eventService = {
      _serviceBrand: undefined,
      onDidPublish: emitter.event,
      publish: (event: Event) => {
        events.push(event);
        emitter.fire(event);
      },
    } satisfies IEventService;
    const service = new ConfigService(core, eventService);

    await expect(service.get()).resolves.toMatchObject({
      persist_default_model: false,
      agents_md_expand_includes: true,
    });

    const updated = await service.set({
      persist_default_model: true,
      agents_md_expand_includes: false,
    });
    expect(setKimiConfig).toHaveBeenCalledWith({
      persistDefaultModel: true,
      agentsMdExpandIncludes: false,
    });
    expect(updated).toMatchObject({
      persist_default_model: true,
      agents_md_expand_includes: false,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'event.config.changed',
        changed_fields: ['persist_default_model', 'agents_md_expand_includes'],
        config: expect.objectContaining({
          persist_default_model: true,
          agents_md_expand_includes: false,
        }),
      }),
    );
  });
});

describe('KimiCore imageLimits scoping', () => {
  it('two cores keep independent [image] limits and only follow their own reloads', async () => {
    const homeA = await makeHome(`${VALID_TOML}
[image]
max_edge_px = 800
read_byte_budget = 65536
`);
    const homeB = await makeHome(`${VALID_TOML}
[image]
max_edge_px = 1600
`);
    const coreA = makeCore(homeA);
    const coreB = makeCore(homeB);

    // Baseline: each core resolves its own [image] section.
    expect(coreA.imageLimits.maxEdgePx()).toBe(800);
    expect(coreA.imageLimits.readByteBudget()).toBe(65536);
    expect(coreB.imageLimits.maxEdgePx()).toBe(1600);
    expect(coreB.imageLimits.readByteBudget()).toBe(256 * 1024);

    // Reloading B must not restamp A (the module-global regression).
    await writeFile(
      path.join(homeB, 'config.toml'),
      `${VALID_TOML}
[image]
max_edge_px = 1000
read_byte_budget = 32768
`,
      'utf-8',
    );
    await coreB.getKimiConfig({ reload: true });
    expect(coreB.imageLimits.maxEdgePx()).toBe(1000);
    expect(coreB.imageLimits.readByteBudget()).toBe(32768);
    expect(coreA.imageLimits.maxEdgePx()).toBe(800);
    expect(coreA.imageLimits.readByteBudget()).toBe(65536);
  });

  it('reloading [image] takes effect on the core instance immediately', async () => {
    const home = await makeHome(VALID_TOML);
    const core = makeCore(home);
    expect(core.imageLimits.maxEdgePx()).toBe(2000);

    await writeFile(
      path.join(home, 'config.toml'),
      `${VALID_TOML}
[image]
max_edge_px = 1400
read_byte_budget = 131072
`,
      'utf-8',
    );
    await core.getKimiConfig({ reload: true });
    expect(core.imageLimits.maxEdgePx()).toBe(1400);
    expect(core.imageLimits.readByteBudget()).toBe(131072);

    // Removing the section clears back to built-ins.
    await writeFile(path.join(home, 'config.toml'), VALID_TOML, 'utf-8');
    await core.getKimiConfig({ reload: true });
    expect(core.imageLimits.maxEdgePx()).toBe(2000);
    expect(core.imageLimits.readByteBudget()).toBe(256 * 1024);
  });
});
