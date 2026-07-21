/**
 * Unit tests for SceneTools.handleConfigureSceneVisionLighting (T36,
 * configure-scene-vision-lighting).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §5.4 + §3. A slice-builder front-end over the
 * shared updateScene seam — it owns no data-access method. What is testable without
 * Foundry:
 *  - builds the narrow vision/lighting fields object and forwards it to the same
 *    GM-scoped updateScene query the umbrella update-scene uses.
 *  - v13 nesting: global illumination → environment.globalLight.enabled, darkness →
 *    environment.darknessLevel (both under one environment sub-object); token vision →
 *    top-level tokenVision.
 *  - only the supplied fields are written (never undefined; exactOptionalPropertyTypes).
 *  - scene_id ⇒ sceneId passthrough; omitted ⇒ no sceneId (active-scene fallback).
 *  - result passes straight through.
 *  - a call with no lighting field supplied is rejected (never a silent no-op write).
 * The actual scene.update() write, the writable-field whitelist, and the live-accepted
 * v13 key shape are Foundry-side (updateSceneFields), exercised at the T36 live gate —
 * not here.
 */

import { describe, it, expect, vi } from 'vitest';
import { SceneTools } from './scene.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ??
      (async () => ({ success: true, sceneId: 'scene1', updatedFields: ['tokenVision'] }))
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

describe('configure-scene-vision-lighting — fronts the updateScene seam', () => {
  it('builds all three fields (env nesting + top-level tokenVision) and forwards them', async () => {
    const { tools, query } = makeTools();
    await tools.handleConfigureSceneVisionLighting({
      global_illumination: true,
      token_vision: false,
      darkness_level: 0.5,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: {
        tokenVision: false,
        environment: { globalLight: { enabled: true }, darknessLevel: 0.5 },
      },
    });
  });

  it('writes only global illumination when only it is supplied', async () => {
    const { tools, query } = makeTools();
    await tools.handleConfigureSceneVisionLighting({ global_illumination: false });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { environment: { globalLight: { enabled: false } } },
    });
  });

  it('writes only token vision when only it is supplied (no environment key)', async () => {
    const { tools, query } = makeTools();
    await tools.handleConfigureSceneVisionLighting({ token_vision: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { tokenVision: true },
    });
  });

  it('writes only darkness under environment when only it is supplied', async () => {
    const { tools, query } = makeTools();
    await tools.handleConfigureSceneVisionLighting({ darkness_level: 1 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { environment: { darknessLevel: 1 } },
    });
  });

  it('forwards scene_id as sceneId when given', async () => {
    const { tools, query } = makeTools();
    await tools.handleConfigureSceneVisionLighting({ darkness_level: 0, scene_id: 'sceneX' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { environment: { darknessLevel: 0 } },
      sceneId: 'sceneX',
    });
  });

  it('omits sceneId when scene_id is absent (active-scene fallback)', async () => {
    const { tools, query } = makeTools();
    await tools.handleConfigureSceneVisionLighting({ token_vision: true });
    expect((query.mock.calls[0][1] as any).sceneId).toBeUndefined();
  });

  it('passes the update result straight through', async () => {
    const payload = { success: true, sceneId: 's1', updatedFields: ['environment'] };
    const { tools } = makeTools(async () => payload);
    const result = await tools.handleConfigureSceneVisionLighting({ global_illumination: true });
    expect(result).toEqual(payload);
  });
});

describe('configure-scene-vision-lighting — validation', () => {
  it('rejects a call with no lighting field supplied', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleConfigureSceneVisionLighting({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a call with only scene_id (no lighting field)', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleConfigureSceneVisionLighting({ scene_id: 'sceneX' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range darkness level', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleConfigureSceneVisionLighting({ darkness_level: 1.5 })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
