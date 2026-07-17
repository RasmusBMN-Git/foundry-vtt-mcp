/**
 * Unit tests for TokenManipulationTools.handleMoveToken and .handleUpdateToken
 * (T32, move_token + visibility toggle).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §3.1 (category 'decision') + §5.5
 * (grid snap). The actual grid-snap math lives inside Foundry's native
 * `canvas.grid.getSnappedPoint`, which needs a live Foundry world (V1 B4
 * already confirmed it live: size 100 / distance 5ft, snapped a raw point to
 * the nearest cell center). What this layer owns and what's testable here
 * without Foundry:
 *  - an NPC target's move/visibility write passes through, surfacing the
 *    snapped previous/new position.
 *  - a PC target is REJECTED outright (pc_decision_barred) — never a
 *    needs_approval payload, never a silent write, and NEVER auto-applied
 *    even if a caller tried to pass a trusted-mode-like flag (movement is a
 *    D2 player decision, not a DM consequence — trusted mode does not apply).
 *  - an invalid target surfaces as a thrown error, never a silent success.
 *  - only the `hidden` field of update-token is gated; other fields
 *    (rotation, disposition, ...) are untouched by T32 and still pass through
 *    on a PC token (regression check that T32 didn't over-gate).
 * Live grid-snap + hide/reveal visual confirmation is folded into T-INT (D12),
 * not here.
 */

import { describe, it, expect, vi } from 'vitest';
import { TokenManipulationTools } from './token-manipulation.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ success: true })));
  const logger: any = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  const foundryClient: any = { query };
  const tools = new TokenManipulationTools({ foundryClient, logger });
  return { tools, query };
}

describe('move-token — NPC target (auto, grid-snapped)', () => {
  it('forwards the requested point and surfaces the snapped previous/new position', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      tokenName: 'Goblin Warrior',
      previousPosition: { x: 100, y: 100 },
      newPosition: { x: 2850, y: 2150 }, // snapped, not the raw requested point
      requestedPosition: { x: 2810, y: 2190 },
      animated: false,
    }));

    const result: any = await tools.handleMoveToken({ tokenId: 'npc1', x: 2810, y: 2190 });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.move-token', {
      tokenId: 'npc1',
      x: 2810,
      y: 2190,
      animate: false,
    });
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 2850, y: 2150 });
    expect(result.previousPosition).toEqual({ x: 100, y: 100 });
  });
});

describe('move-token — PC target (decision, rejected)', () => {
  it('throws on pc_decision_barred, never a silent write and never needs_approval', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'pc_decision_barred',
      tokenId: 'pc1',
    }));

    await expect(tools.handleMoveToken({ tokenId: 'pc1', x: 100, y: 100 })).rejects.toThrow(
      /pc1.*pc_decision_barred|pc_decision_barred.*pc1/is
    );
  });

  it('rejects a PC target even if the caller tries to pass a trusted-mode-like flag', async () => {
    // move_token takes no trustedMode param at all (category 'decision' never
    // honors it) — this asserts the tool does not silently forward or invent
    // one that would let a PC move slip through.
    const { tools, query } = makeTools(async () => ({
      success: false,
      error: 'pc_decision_barred',
      tokenId: 'pc1',
    }));

    await expect(
      tools.handleMoveToken({ tokenId: 'pc1', x: 100, y: 100, trustedMode: true } as any)
    ).rejects.toThrow();

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.move-token',
      expect.not.objectContaining({ trustedMode: expect.anything() })
    );
  });
});

describe('move-token — invalid target', () => {
  it('throws, never a silent success', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(tools.handleMoveToken({ tokenId: 'ghost', x: 0, y: 0 })).rejects.toThrow(
      /invalid_target/i
    );
  });
});

describe('move-token — schema validation', () => {
  it('rejects a call missing y before calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleMoveToken({ tokenId: 'npc1', x: 1 } as any)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('update-token — visibility (hidden), NPC target (auto)', () => {
  it('applies a hide/reveal toggle and passes the result through', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));

    const result: any = await tools.handleUpdateToken({
      tokenId: 'npc1',
      updates: { hidden: true },
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.update-token', {
      tokenId: 'npc1',
      updates: { hidden: true },
    });
    expect(result.success).toBe(true);
    expect(result.appliedUpdates).toEqual({ hidden: true });
  });
});

describe('update-token — visibility (hidden), PC target (decision, rejected)', () => {
  it('throws on pc_decision_barred — a PC token is never hidden from its own owner', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'pc_decision_barred',
      tokenId: 'pc1',
    }));

    await expect(
      tools.handleUpdateToken({ tokenId: 'pc1', updates: { hidden: true } })
    ).rejects.toThrow(/pc_decision_barred/i);
  });
});

describe('update-token — non-visibility fields are unaffected by the T32 gate', () => {
  it('still applies a rotation update to a PC token (out of T32 scope, ungated)', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));

    const result: any = await tools.handleUpdateToken({
      tokenId: 'pc1',
      updates: { rotation: 90 },
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.update-token', {
      tokenId: 'pc1',
      updates: { rotation: 90 },
    });
    expect(result.success).toBe(true);
  });
});

describe('update-token — invalid target', () => {
  it('throws, never a silent success', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(
      tools.handleUpdateToken({ tokenId: 'ghost', updates: { hidden: false } })
    ).rejects.toThrow(/invalid_target/i);
  });
});
