/**
 * Unit tests for TokenManipulationTools.handleTickPersistentAoe (T35,
 * conditional — persistent_aoe_tick).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §3 (bookkeeping call, per-occupant
 * consequence gate). The conditional gate itself — whether a native
 * token-in-template occupancy test exists — was verified LIVE against the
 * Testlab world (2026-07-17, Shadow GM session): `templatePlaceable.testPoint
 * ({x,y})` correctly distinguished a point 7.5ft from center (inside a 10ft
 * circle) from one at 12.5ft (outside). That geometry itself needs a live
 * Foundry canvas and isn't unit-testable here. What this layer owns and is
 * testable without Foundry:
 *  - templateId/damage/conditionId/durationRounds/trustedMode are forwarded
 *    verbatim to the bridge query.
 *  - the per-occupant array (each carrying its own auto/needs_approval/
 *    invalid_target decision) passes straight through — this handler never
 *    throws on an individual occupant's gate outcome, since occupants are
 *    gated independently, not as a single call target.
 * Live occupancy + damage/condition application is folded into T-INT (D12).
 */

import { describe, it, expect, vi } from 'vitest';
import { TokenManipulationTools } from './token-manipulation.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ success: true, occupants: [] })));
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

describe('tick-persistent-aoe — request shape', () => {
  it('forwards templateId/damage/conditionId/durationRounds verbatim', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      templateId: 'tmpl1',
      occupants: [],
    }));

    await tools.handleTickPersistentAoe({
      templateId: 'tmpl1',
      damage: [{ value: 2, type: 'poison' }],
      conditionId: 'poisoned',
      durationRounds: 3,
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.tickPersistentAoeTemplate', {
      templateId: 'tmpl1',
      damage: [{ value: 2, type: 'poison' }],
      conditionId: 'poisoned',
      durationRounds: 3,
      trustedMode: false,
    });
  });

  it('defaults trustedMode to false when omitted', async () => {
    const { tools, query } = makeTools();
    await tools.handleTickPersistentAoe({ templateId: 'tmpl1' });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.tickPersistentAoeTemplate',
      expect.objectContaining({ trustedMode: false })
    );
  });

  it('forwards trustedMode:true so a PC occupant can auto-apply', async () => {
    const { tools, query } = makeTools();
    await tools.handleTickPersistentAoe({ templateId: 'tmpl1', trustedMode: true });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.tickPersistentAoeTemplate',
      expect.objectContaining({ trustedMode: true })
    );
  });
});

describe('tick-persistent-aoe — mixed occupants', () => {
  it('passes a mixed auto/needs_approval occupants array straight through without throwing', async () => {
    const occupants = [
      { tokenId: 'npc1', tokenName: 'Goblin', decision: 'auto', hpBefore: 7, hpAfter: 5 },
      {
        tokenId: 'pc1',
        tokenName: 'TestPC',
        decision: 'needs_approval',
        approval: {
          ok: false,
          status: 'needs_approval',
          verb: 'persistent_aoe_tick',
          target: { token_id: 'pc1', name: 'TestPC', is_pc: true },
          proposed: { damage: [{ value: 2, type: 'poison' }] },
          reason: 'PC-affecting write requires approval (D4)',
        },
      },
    ];
    const { tools } = makeTools(async () => ({ success: true, templateId: 'tmpl1', occupants }));

    const result: any = await tools.handleTickPersistentAoe({
      templateId: 'tmpl1',
      damage: [{ value: 2, type: 'poison' }],
    });

    expect(result.occupants).toEqual(occupants);
  });

  it('handles an empty zone (no occupants) without error', async () => {
    const { tools } = makeTools(async () => ({
      success: true,
      templateId: 'tmpl1',
      occupants: [],
    }));
    const result: any = await tools.handleTickPersistentAoe({ templateId: 'tmpl1' });
    expect(result.occupants).toEqual([]);
  });
});

describe('tick-persistent-aoe — schema validation', () => {
  it('rejects a missing templateId before calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleTickPersistentAoe({} as any)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a damage entry missing a type', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleTickPersistentAoe({ templateId: 'tmpl1', damage: [{ value: 5 }] } as any)
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
