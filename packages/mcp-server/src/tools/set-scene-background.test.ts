/**
 * Unit tests for SceneTools.handleSetSceneBackground (T36, set-scene-background).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §5.3 + §3. A slice-builder front-end over the
 * shared updateScene seam — it owns no data-access method. What is testable without
 * Foundry:
 *  - builds the narrow { background: { src } } fields object and forwards it to the
 *    same GM-scoped updateScene query the umbrella update-scene uses.
 *  - scene_id ⇒ sceneId passthrough; omitted ⇒ no sceneId (active-scene fallback).
 *  - result passes straight through.
 *  - a missing/empty src is rejected (never a silent no-op write).
 * The actual scene.update() write, the writable-field whitelist, and the resulting
 * hasBackground flag are Foundry-side (updateSceneFields), exercised at the T36 live
 * gate — not here.
 */

import { describe, it, expect, vi } from 'vitest';
import { SceneTools } from './scene.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ?? (async () => ({ success: true, sceneId: 'scene1', updatedFields: ['background'] }))
  );
  const logger: any = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  const foundryClient: any = { query };
  const tools = new SceneTools({ foundryClient, logger });
  return { tools, query };
}

describe('set-scene-background — fronts the updateScene seam', () => {
  it('builds { background: { src } } and forwards to updateScene', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneBackground({ src: 'worlds/w/maps/dungeon.webp' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { background: { src: 'worlds/w/maps/dungeon.webp' } },
    });
  });

  it('forwards scene_id as sceneId when given', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneBackground({ src: 'a.webp', scene_id: 'sceneX' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { background: { src: 'a.webp' } },
      sceneId: 'sceneX',
    });
  });

  it('omits sceneId when scene_id is absent (active-scene fallback)', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneBackground({ src: 'a.webp' });
    expect((query.mock.calls[0][1] as any).sceneId).toBeUndefined();
  });

  it('passes the update result straight through', async () => {
    const payload = { success: true, sceneId: 's1', updatedFields: ['background'] };
    const { tools } = makeTools(async () => payload);
    const result = await tools.handleSetSceneBackground({ src: 'a.webp' });
    expect(result).toEqual(payload);
  });
});

describe('set-scene-background — validation', () => {
  it('rejects a missing src', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSetSceneBackground({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an empty src', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSetSceneBackground({ src: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
