/**
 * Unit tests for SceneTools.handleSetSceneGridDimensions (T36,
 * set-scene-grid-dimensions).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §5.5 + §3. A slice-builder front-end over the
 * shared updateScene seam — it owns no data-access method. What is testable without
 * Foundry:
 *  - builds the narrow grid/dimensions fields object and forwards it to the same
 *    GM-scoped updateScene query the umbrella update-scene uses.
 *  - v13 nesting: grid_type/size/distance/units collapse under one nested grid
 *    sub-object; width/height stay top-level.
 *  - only the supplied fields are written (never undefined; exactOptionalPropertyTypes).
 *  - scene_id ⇒ sceneId passthrough; omitted ⇒ no sceneId (active-scene fallback).
 *  - result passes straight through.
 *  - a call with no field supplied is rejected (never a silent no-op write).
 * The actual scene.update() write, the writable-field whitelist, and the live-accepted
 * v13 key shape are Foundry-side (updateSceneFields), exercised at the T36 live gate —
 * not here.
 */

import { describe, it, expect, vi } from 'vitest';
import { SceneTools } from './scene.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ?? (async () => ({ success: true, sceneId: 'scene1', updatedFields: ['grid'] }))
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

describe('set-scene-grid-dimensions — fronts the updateScene seam', () => {
  it('builds all grid fields (nested) + top-level width/height and forwards them', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneGridDimensions({
      grid_type: 1,
      grid_size: 100,
      grid_distance: 5,
      grid_units: 'ft',
      width: 2000,
      height: 1500,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: {
        grid: { type: 1, size: 100, distance: 5, units: 'ft' },
        width: 2000,
        height: 1500,
      },
    });
  });

  it('writes only the supplied grid sub-fields (partial grid, no dimensions)', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneGridDimensions({ grid_size: 150, grid_distance: 10 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { grid: { size: 150, distance: 10 } },
    });
  });

  it('writes only dimensions when no grid field is supplied (no grid key)', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneGridDimensions({ width: 3000, height: 3000 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { width: 3000, height: 3000 },
    });
  });

  it('writes only width when only it is supplied', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneGridDimensions({ width: 1024 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { width: 1024 },
    });
  });

  it('writes only the grid type under the nested grid object', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneGridDimensions({ grid_type: 0 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { grid: { type: 0 } },
    });
  });

  it('forwards scene_id as sceneId when given', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneGridDimensions({ grid_size: 100, scene_id: 'sceneX' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.updateScene', {
      fields: { grid: { size: 100 } },
      sceneId: 'sceneX',
    });
  });

  it('omits sceneId when scene_id is absent (active-scene fallback)', async () => {
    const { tools, query } = makeTools();
    await tools.handleSetSceneGridDimensions({ width: 800 });
    expect((query.mock.calls[0][1] as any).sceneId).toBeUndefined();
  });

  it('passes the update result straight through', async () => {
    const payload = { success: true, sceneId: 's1', updatedFields: ['grid', 'width'] };
    const { tools } = makeTools(async () => payload);
    const result = await tools.handleSetSceneGridDimensions({ grid_size: 100, width: 800 });
    expect(result).toEqual(payload);
  });
});

describe('set-scene-grid-dimensions — validation', () => {
  it('rejects a call with no field supplied', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSetSceneGridDimensions({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a call with only scene_id (no grid/dimension field)', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSetSceneGridDimensions({ scene_id: 'sceneX' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a grid_size below the Foundry hard minimum of 50', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSetSceneGridDimensions({ grid_size: 40 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a non-positive width', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSetSceneGridDimensions({ width: 0 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
