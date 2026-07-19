/**
 * Unit tests for FoundryDataAccess.moveToken's snap-to-cell-center fix
 * (T32-FIX, reopened from T-INT NO-GO 2026-07-18).
 *
 * Contract: `getSnappedPoint` (mocked here, native in Foundry) returns a cell
 * CENTER, but `token.update({x,y})` writes the token's top-left corner. Before
 * this fix a 1x1 token's center landed on the 4-cell intersection instead of
 * inside one cell. The fix offsets the snapped center by half the token's
 * footprint (grid.size in px x token.width/height in grid units) before the
 * write — still native snapping, only a size term added (CLAUDE.md bars
 * hand-rolled grid geometry).
 *
 * Foundry globals (`game`, `canvas`, `CONST`) are stubbed on globalThis so
 * `moveToken` runs unmodified against fake scene/token/grid objects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

const GRID_SIZE = 100;

function makeToken(
  overrides: Partial<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
  }> = {}
) {
  const token: any = {
    id: overrides.id ?? 'npc1',
    name: overrides.name ?? 'Goblin Warrior',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    width: overrides.width ?? 1,
    height: overrides.height ?? 1,
    update: vi.fn(async (data: any) => {
      Object.assign(token, data);
      return token;
    }),
  };
  return token;
}

function makeCanvasActor(tokenId: string, name: string, isPC: boolean) {
  return { name, actor: { name, hasPlayerOwner: isPC } };
}

function installFoundryGlobals(opts: { sceneToken: any; canvasTokenTable: Record<string, any> }) {
  const scene = {
    grid: { size: GRID_SIZE, distance: 5 },
    tokens: { get: (id: string) => (opts.sceneToken?.id === id ? opts.sceneToken : undefined) },
  };

  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world', setFlag: undefined },
    user: { id: 'gm1', name: 'GM' },
    settings: {
      get: (_mod: string, key: string) => (key === 'allowWriteOperations' ? true : true),
    },
    scenes: { current: scene },
  };

  (globalThis as any).canvas = {
    grid: {
      // Snaps to the nearest cell CENTER (native Foundry behavior being mocked).
      getSnappedPoint: vi.fn((point: { x: number; y: number }) => {
        const cellX = Math.floor(point.x / GRID_SIZE);
        const cellY = Math.floor(point.y / GRID_SIZE);
        return {
          x: cellX * GRID_SIZE + GRID_SIZE / 2,
          y: cellY * GRID_SIZE + GRID_SIZE / 2,
        };
      }),
    },
    tokens: { get: (id: string) => opts.canvasTokenTable[id] },
  };

  (globalThis as any).CONST = { GRID_SNAPPING_MODES: { CENTER: 1 } };

  // FoundryDataAccess's constructor eagerly builds a PersistentCreatureIndex,
  // which registers Hooks listeners — stub the minimal API so `new
  // FoundryDataAccess()` doesn't throw outside a live Foundry world.
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };

  return { scene };
}

describe('moveToken — cell-centering (T32-FIX)', () => {
  afterEach(() => {
    delete (globalThis as any).game;
    delete (globalThis as any).canvas;
    delete (globalThis as any).CONST;
    delete (globalThis as any).Hooks;
    vi.restoreAllMocks();
  });

  it('centers a 1x1 token inside a single cell, not on the intersection', async () => {
    const sceneToken = makeToken({ id: 'npc1', width: 1, height: 1 });
    installFoundryGlobals({
      sceneToken,
      canvasTokenTable: { npc1: makeCanvasActor('npc1', 'Goblin Warrior', false) },
    });

    const dal = new FoundryDataAccess();
    const result: any = await dal.moveToken({ tokenId: 'npc1', x: 2810, y: 2190 });

    expect(result.success).toBe(true);
    // getSnappedPoint would return the cell center (2850, 2150) for this input.
    // A 1x1 token's top-left must be offset by half a cell so it sits on the
    // cell's own corner (2800, 2100) — i.e. inside cell [28,21], not straddling
    // the intersection at (2850, 2150).
    expect(result.newPosition).toEqual({ x: 2800, y: 2100 });
    expect(sceneToken.update).toHaveBeenCalledWith(
      { x: 2800, y: 2100 },
      expect.objectContaining({ animate: true })
    );
  });

  it('offsets a 2x2 token by a full cell on each axis', async () => {
    const sceneToken = makeToken({ id: 'npc2', width: 2, height: 2 });
    installFoundryGlobals({
      sceneToken,
      canvasTokenTable: { npc2: makeCanvasActor('npc2', 'Ogre', false) },
    });

    const dal = new FoundryDataAccess();
    const result: any = await dal.moveToken({ tokenId: 'npc2', x: 2810, y: 2190 });

    expect(result.success).toBe(true);
    // Snapped center is still (2850, 2150); a 2x2 footprint offsets by a full
    // cell (100px) on each axis instead of half.
    expect(result.newPosition).toEqual({ x: 2750, y: 2050 });
  });

  it('still rejects a PC-target move outright (decision category unchanged)', async () => {
    const sceneToken = makeToken({ id: 'pc1', width: 1, height: 1 });
    installFoundryGlobals({
      sceneToken,
      canvasTokenTable: { pc1: makeCanvasActor('pc1', 'TestPC', true) },
    });

    const dal = new FoundryDataAccess();
    const result: any = await dal.moveToken({ tokenId: 'pc1', x: 100, y: 100 });

    expect(result.success).toBe(false);
    expect(result.error).toBe('pc_decision_barred');
    expect(sceneToken.update).not.toHaveBeenCalled();
  });
});
