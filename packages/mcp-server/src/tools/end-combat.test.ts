/**
 * Unit tests for CombatTools.handleEndCombat (T36, end-combat).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §5.1 (combat-lifecycle bookkeeping).
 * end-combat takes no arguments, targets no token, and needs no gate/approval.
 * What this layer owns and what's testable here without Foundry:
 *  - the tool forwards to the bridge endCombat query with an empty payload.
 *  - the { success, ended } summary passes straight through to the DM.
 *  - a bridge error (e.g. no active combat) surfaces as a thrown error, never a
 *    silent success.
 * The native combat.delete() / deleteCombat-hook behavior lives inside Foundry
 * (dialog-free hard delete, scene-mgmt-SPEC §5.1) and is exercised at the T36
 * live gate (TC-scene-gen-edit-maintenance), not here.
 */

import { describe, it, expect, vi } from 'vitest';
import { CombatTools } from './combat.js';

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
  const tools = new CombatTools({ foundryClient, logger });
  return { tools, query };
}

describe('end-combat — combat-lifecycle bookkeeping (no target, no gate)', () => {
  it('forwards to the bridge endCombat query with an empty payload', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      ended: { combatId: 'cmb1', round: 3, combatantCount: 4 },
    }));

    const result: any = await tools.handleEndCombat({});

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.endCombat', {});
    expect(result.success).toBe(true);
    expect(result.ended.combatId).toBe('cmb1');
  });

  it('passes the { success, ended } summary straight through', async () => {
    const payload = {
      success: true,
      ended: { combatId: 'cmb2', round: 1, combatantCount: 2 },
    };
    const { tools } = makeTools(async () => payload);

    const result = await tools.handleEndCombat({});

    expect(result).toEqual(payload);
  });

  it('does not gate — no needs_approval shape is ever returned', async () => {
    const { tools, query } = makeTools(async () => ({ success: true, ended: null }));
    const result: any = await tools.handleEndCombat({});
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.status).toBeUndefined();
  });

  it('ignores any incidental args (the tool takes none)', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));
    await tools.handleEndCombat({ unexpected: 'ignored' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.endCombat', {});
  });
});

describe('end-combat — no active combat', () => {
  it('surfaces a bridge error as a thrown error, never a silent success', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('No active combat to end');
    });

    await expect(tools.handleEndCombat({})).rejects.toThrow(/active combat|end combat/i);
  });
});
