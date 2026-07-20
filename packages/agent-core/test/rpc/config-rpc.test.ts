import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { KimiCore } from '../../src/rpc/core-impl';

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

  it('model-only patch keeps session defaultModel without writing disk', async () => {
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

    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
    expect(after).toContain('default_model = "disk-model"');
    expect(after).not.toMatch(/default_model\s*=\s*"session-model"/);

    const again = await core.getKimiConfig({});
    expect(again.defaultModel).toBe('session-model');
  });

  it('non-model patch freezes default_model on disk but keeps session model in runtime', async () => {
    const home = await makeHome(PDM_TOML);
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');

    const runtime = await core.setKimiConfig({
      defaultModel: 'session-model',
      thinking: { effort: 'low' },
      models: {
        'disk-model': {
          provider: 'p',
          model: 'disk',
          maxContextSize: 1000,
        },
        'session-model': {
          provider: 'p',
          model: 'session',
          maxContextSize: 1000,
        },
        extra: {
          provider: 'p',
          model: 'extra',
          maxContextSize: 1000,
        },
      },
    });
    expect(runtime.defaultModel).toBe('session-model');
    expect(runtime.thinking?.effort).toBe('low');
    expect(runtime.models?.['extra']).toBeDefined();

    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('default_model = "disk-model"');
    expect(text).not.toMatch(/default_model\s*=\s*"session-model"/);
    expect(text).toMatch(/\[models\.extra\]/);
  });

  it('model-only patch still persists when flag is true', async () => {
    const home = await makeHome(`
persist_default_model = true
default_model = "disk-model"

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
    const core = makeCore(home);
    const runtime = await core.setKimiConfig({ defaultModel: 'session-model' });
    expect(runtime.defaultModel).toBe('session-model');
    const text = await readFile(path.join(home, 'config.toml'), 'utf-8');
    expect(text).toContain('default_model = "session-model"');
  });

  it('sequential model-only patches keep prior session defaultModel when flag is false', async () => {
    const home = await makeHome(PDM_TOML);
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');
    const before = await readFile(configPath, 'utf-8');

    await core.setKimiConfig({ defaultModel: 'session-model' });
    const runtime = await core.setKimiConfig({ thinking: { effort: 'low' } });

    expect(runtime.defaultModel).toBe('session-model');
    expect(runtime.thinking?.effort).toBe('low');
    expect(await readFile(configPath, 'utf-8')).toBe(before);
  });

  it('non-model patch after session model keeps session defaultModel and freezes disk', async () => {
    const home = await makeHome(PDM_TOML);
    const core = makeCore(home);
    const configPath = path.join(home, 'config.toml');

    await core.setKimiConfig({ defaultModel: 'session-model', thinking: { effort: 'low' } });
    const runtime = await core.setKimiConfig({
      models: {
        'disk-model': {
          provider: 'p',
          model: 'disk',
          maxContextSize: 1000,
        },
        'session-model': {
          provider: 'p',
          model: 'session',
          maxContextSize: 1000,
        },
        extra: {
          provider: 'p',
          model: 'extra',
          maxContextSize: 1000,
        },
      },
    });

    expect(runtime.defaultModel).toBe('session-model');
    expect(runtime.thinking?.effort).toBe('low');
    expect(runtime.models?.['extra']).toBeDefined();

    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('default_model = "disk-model"');
    expect(text).not.toMatch(/default_model\s*=\s*"session-model"/);
    expect(text).toMatch(/\[models\.extra\]/);
    // thinking on disk must stay frozen at the original high effort
    expect(text).toMatch(/effort\s*=\s*"high"/);
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
