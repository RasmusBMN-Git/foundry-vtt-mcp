/**
 * Unit tests for TokenManipulationTools.handleAdvanceTurn (T-ADV, advance_turn).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §3.1 (bookkeeping category).
 * advance_turn is pure NPC-side turn bookkeeping: no target, no gate, no D4
 * approval. What this layer owns and what's testable here without Foundry:
 *  - the tool forwards to the bridge query with no arguments (it takes none).
 *  - the previous/current combatant result passes straight through to the DM.
 *  - a bridge error surfaces as a thrown error, never a silent success.
 * The native nextTurn / skipDefeated behavior lives inside Foundry's Combat
 * (confirmed live at T28's dead-combatant-skip finding) and is folded into
 * T-INT (D12), not here.
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

describe('advance-turn — bookkeeping (no target, no gate)', () => {
  it('forwards to the bridge advanceTurn query with no arguments', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      previous: { combatantId: 'c1', tokenId: 't1', round: 1 },
      current: { combatantId: 'c2', tokenId: 't2', name: 'Goblin', round: 1 },
    }));

    const result: any = await tools.handleAdvanceTurn({});

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.advanceTurn', {});
    expect(result.success).toBe(true);
    expect(result.current.combatantId).toBe('c2');
  });

  it('passes the previous/current combatant result straight through', async () => {
    const payload = {
      success: true,
      previous: { combatantId: 'c2', tokenId: 't2', round: 1 },
      current: { combatantId: 'c3', tokenId: 't3', name: 'Orc', round: 2, isDefeated: false },
    };
    const { tools } = makeTools(async () => payload);

    const result = await tools.handleAdvanceTurn({});

    expect(result).toEqual(payload);
  });

  it('does not throw or gate — no approval shape is ever returned', async () => {
    const { tools, query } = makeTools(async () => ({ success: true, current: null }));
    const result: any = await tools.handleAdvanceTurn({});
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.status).toBeUndefined(); // never a needs_approval payload
  });
});

describe('advance-turn — no active combat', () => {
  it('surfaces a bridge error as a thrown error, never a silent success', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('No active combat to advance');
    });

    await expect(tools.handleAdvanceTurn({})).rejects.toThrow(/advance turn/i);
  });
});
