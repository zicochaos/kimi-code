import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configResponseSchema, type ConfigResponse } from '../src/protocol/rest-config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type RunningServer, startServer } from '../src/start';
import { authedFetch } from './helpers/auth';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

describe('server-v2 /api/v1/config', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kimi-server-v2-config-'));
  });

  afterEach(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  async function boot(toml?: string): Promise<void> {
    if (toml !== undefined) {
      await writeFile(join(home as string, 'config.toml'), toml, 'utf-8');
    }
    server = await startServer({
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  }

  async function getConfig(): Promise<ConfigResponse> {
    const res = await authedFetch(server as RunningServer, base, '/api/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<ConfigResponse>;
    expect(body.code).toBe(0);
    return configResponseSchema.parse(body.data);
  }

  async function patchConfig(patch: Record<string, unknown>): Promise<ConfigResponse> {
    const res = await authedFetch(server as RunningServer, base, '/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<ConfigResponse>;
    expect(body.code).toBe(0);
    return configResponseSchema.parse(body.data);
  }

  it('GET echoes default_permission_mode and derives yolo = false', async () => {
    await boot('default_permission_mode = "auto"\n');
    const cfg = await getConfig();
    expect(cfg.default_permission_mode).toBe('auto');
    expect(cfg.yolo).toBe(false);
  });

  it('POST { yolo: true } sets default_permission_mode = yolo and echoes yolo = true', async () => {
    await boot();
    const cfg = await patchConfig({ yolo: true });
    expect(cfg.default_permission_mode).toBe('yolo');
    expect(cfg.yolo).toBe(true);

    const after = await getConfig();
    expect(after.default_permission_mode).toBe('yolo');
    expect(after.yolo).toBe(true);
  });

  it('POST { default_permission_mode: auto } writes the canonical field and derives yolo = false', async () => {
    await boot();
    const cfg = await patchConfig({ default_permission_mode: 'auto' });
    expect(cfg.default_permission_mode).toBe('auto');
    expect(cfg.yolo).toBe(false);

    const after = await getConfig();
    expect(after.default_permission_mode).toBe('auto');
    expect(after.yolo).toBe(false);
  });
  it('POST secondary_model persists [secondary_model] and echoes it on GET', async () => {
    await boot();
    const cfg = await patchConfig({
      secondary_model: { model: 'k2-test', default_effort: 'high' },
    });
    expect(cfg.secondary_model).toEqual({ model: 'k2-test', defaultEffort: 'high' });

    const after = await getConfig();
    expect(after.secondary_model).toEqual({ model: 'k2-test', defaultEffort: 'high' });

    const toml = await readFile(join(home as string, 'config.toml'), 'utf-8');
    expect(toml).toContain('[secondary_model]');
    expect(toml).toContain('model = "k2-test"');
    expect(toml).toContain('default_effort = "high"');
  });

  it('GET hides the synthesized __secondary__ derived entry from models', async () => {
    await boot('[models.k2-test]\nprovider = "example"\nmodel = "example-model"\n');
    // `default_effort` is a patch field, so the overlay synthesizes the
    // `__secondary__` derived entry into the effective `models` view.
    const cfg = await patchConfig({
      secondary_model: { model: 'k2-test', default_effort: 'high' },
    });
    const models = cfg.models as Record<string, unknown>;
    expect(models['k2-test']).toBeDefined();
    expect(models['__secondary__']).toBeUndefined();

    const after = await getConfig();
    const afterModels = after.models as Record<string, unknown>;
    expect(afterModels['k2-test']).toBeDefined();
    expect(afterModels['__secondary__']).toBeUndefined();
  });

  it('GET and POST retain fork config booleans', async () => {
    await boot('persist_default_model = false\nagents_md_expand_includes = false\n');

    const initial = await getConfig();
    expect(initial.persist_default_model).toBe(false);
    expect(initial.agents_md_expand_includes).toBe(false);

    const updated = await patchConfig({
      persist_default_model: true,
      agents_md_expand_includes: true,
    });
    expect(updated.persist_default_model).toBe(true);
    expect(updated.agents_md_expand_includes).toBe(true);

    const after = await getConfig();
    expect(after.persist_default_model).toBe(true);
    expect(after.agents_md_expand_includes).toBe(true);
    const text = await readFile(join(home as string, 'config.toml'), 'utf-8');
    expect(text).toContain('persist_default_model = true');
    expect(text).toContain('agents_md_expand_includes = true');
  });

  it('keeps default_model and thinking in memory when persistence is disabled', async () => {
    const initial = `
persist_default_model = false
default_model = "disk-model"

[thinking]
enabled = true
effort = "high"

[models.disk-model]
model = "disk-model"
max_context_size = 1000

[models.session-model]
model = "session-model"
max_context_size = 1000
`;
    await boot(initial);

    const cfg = await patchConfig({
      default_model: 'session-model',
      thinking: { effort: 'low' },
    });

    expect(cfg.persist_default_model).toBe(false);
    expect(cfg.default_model).toBe('session-model');
    expect(cfg.thinking).toEqual({ enabled: true, effort: 'low' });
    expect(await readFile(join(home as string, 'config.toml'), 'utf-8')).toBe(initial);

    const persisted = await patchConfig({ persist_default_model: true });
    expect(persisted.persist_default_model).toBe(true);
    expect(persisted.default_model).toBe('session-model');
    expect(persisted.thinking).toEqual({ enabled: true, effort: 'low' });
    const text = await readFile(join(home as string, 'config.toml'), 'utf-8');
    expect(text).toContain('persist_default_model = true');
    expect(text).toContain('default_model = "session-model"');
    expect(text).toContain('enabled = true');
    expect(text).toContain('effort = "low"');
  });
});
