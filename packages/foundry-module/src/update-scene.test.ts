/**
 * Unit tests for FoundryDataAccess.updateSceneFields (T36, update-scene seam).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §3/§5.6 — the shared, validated umbrella
 * over scene.update() that the field setters also front. What it guarantees:
 *  - whitelisted top-level fields are written via scene.update(fields).
 *  - any non-whitelisted key is REJECTED (thrown), and scene.update is NOT called
 *    — nothing is silently written (the frozen safety property).
 *  - an empty / non-object fields payload is rejected.
 *  - sceneId targets a named scene (game.scenes.get); omitted ⇒ active scene
 *    (game.scenes.current); an unknown sceneId throws.
 *  - returns { success, sceneId, updatedFields }.
 *
 * Foundry globals (`game`) are stubbed on globalThis so updateSceneFields runs
 * unmodified against fake scene objects.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeScene(id: string) {
  return {
    id,
    update: vi.fn(async (_fields: Record<string, any>) => ({})),
  };
}

function installFoundryGlobals(opts: { current?: any; byId?: Record<string, any> }) {
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM', isGM: true },
    scenes: {
      current: opts.current ?? null,
      get: (id: string) => opts.byId?.[id],
    },
  };

  // FoundryDataAccess's ctor builds a PersistentCreatureIndex that registers
  // Foundry hooks — stub Hooks so construction doesn't throw.
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
}

describe('updateSceneFields — whitelist + write (T36)', () => {
  afterEach(() => {
    delete (globalThis as any).game;
    delete (globalThis as any).Hooks;
    vi.restoreAllMocks();
  });

  it('writes whitelisted fields via scene.update and returns the summary', async () => {
    const scene = makeScene('sc1');
    installFoundryGlobals({ current: scene });

    const dal = new FoundryDataAccess();
    const result: any = await dal.updateSceneFields(undefined, {
      name: 'Cavern',
      background: { src: 'worlds/w/map.webp' },
    });

    expect(scene.update).toHaveBeenCalledWith({
      name: 'Cavern',
      background: { src: 'worlds/w/map.webp' },
    });
    expect(result).toEqual({
      success: true,
      sceneId: 'sc1',
      updatedFields: ['name', 'background'],
    });
  });

  it('rejects a non-whitelisted field and never calls scene.update', async () => {
    const scene = makeScene('sc1');
    installFoundryGlobals({ current: scene });

    const dal = new FoundryDataAccess();
    await expect(
      dal.updateSceneFields(undefined, { background: { src: 'x' }, permission: { default: 3 } })
    ).rejects.toThrow(/non-whitelisted.*permission/i);
    expect(scene.update).not.toHaveBeenCalled();
  });

  it('rejects an empty fields object', async () => {
    const scene = makeScene('sc1');
    installFoundryGlobals({ current: scene });

    const dal = new FoundryDataAccess();
    await expect(dal.updateSceneFields(undefined, {})).rejects.toThrow(/non-empty object/i);
    expect(scene.update).not.toHaveBeenCalled();
  });

  it('targets a named scene by sceneId', async () => {
    const active = makeScene('active');
    const target = makeScene('target');
    installFoundryGlobals({ current: active, byId: { target } });

    const dal = new FoundryDataAccess();
    const result: any = await dal.updateSceneFields('target', { tokenVision: false });

    expect(target.update).toHaveBeenCalledWith({ tokenVision: false });
    expect(active.update).not.toHaveBeenCalled();
    expect(result.sceneId).toBe('target');
  });

  it('throws when the named scene does not exist', async () => {
    installFoundryGlobals({ current: makeScene('active'), byId: {} });

    const dal = new FoundryDataAccess();
    await expect(dal.updateSceneFields('missing', { name: 'X' })).rejects.toThrow(
      /Scene not found: missing/i
    );
  });

  it('throws when there is no active scene and no sceneId', async () => {
    installFoundryGlobals({ current: null });

    const dal = new FoundryDataAccess();
    await expect(dal.updateSceneFields(undefined, { name: 'X' })).rejects.toThrow(
      /No active scene/i
    );
  });
});
