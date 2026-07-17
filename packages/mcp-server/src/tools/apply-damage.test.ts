/**
 * Unit tests for TokenManipulationTools.handleApplyDamage (T31, apply_damage).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §5.1 + §3 (consequence category).
 * The actual resistance/vulnerability/immunity math lives inside dnd5e's
 * `actor.applyDamage`, which needs a live Foundry world (V1 B1 already
 * confirmed it live: 10 cold on a cold-resistant NPC → 5 taken). What this
 * layer owns and what's testable here without Foundry:
 *  - typed damage is forwarded to the bridge query VERBATIM — this tool never
 *    pre-computes resistance itself (that would be the "raw hp.value write"
 *    the contract explicitly rejects).
 *  - a PC target's needs_approval response passes straight through (D4).
 *  - an invalid target surfaces as a thrown error, never a silent success.
 *  - trustedMode is forwarded so the Foundry-side gate can auto-apply PC
 *    consequences per the D4 addendum.
 * Live resistance/temp-HP confirmation is folded into T-INT (D12), not here.
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

describe('apply-damage — NPC target (auto)', () => {
  it('forwards typed damage verbatim, never pre-computing resistance client-side', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      hpBefore: 22,
      hpAfter: 17, // resistance halved 10 -> 5, applied server-side by dnd5e
      delta: 5,
    }));

    const result: any = await tools.handleApplyDamage({
      tokenId: 'npc1',
      damage: [{ value: 10, type: 'cold' }],
    });

    // The client sent the RAW typed damage — it did not halve it itself.
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.applyDamage', {
      tokenId: 'npc1',
      damage: [{ value: 10, type: 'cold' }],
      multiplier: 1,
      trustedMode: false,
    });
    expect(result.success).toBe(true);
    expect(result.hpAfter).toBe(17);
  });

  it('forwards a heal via multiplier: -1 unchanged', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));
    await tools.handleApplyDamage({
      tokenId: 'npc1',
      damage: [{ value: 10, type: 'cold' }],
      multiplier: -1,
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.applyDamage',
      expect.objectContaining({ multiplier: -1 })
    );
  });
});

describe('apply-damage — PC target (D4 gate)', () => {
  it('passes a needs_approval response straight through, performing no retry/write', async () => {
    const approval = {
      ok: false,
      status: 'needs_approval',
      verb: 'apply_damage',
      target: { token_id: 'pc1', name: 'TestPC', is_pc: true },
      proposed: { damage: [{ value: 8, type: 'slashing' }], multiplier: 1 },
      reason: 'PC-affecting write requires approval (D4)',
    };
    const { tools, query } = makeTools(async () => approval);

    const result = await tools.handleApplyDamage({
      tokenId: 'pc1',
      damage: [{ value: 8, type: 'slashing' }],
    });

    expect(result).toEqual(approval);
    expect(query).toHaveBeenCalledTimes(1); // no automatic retry
  });

  it('forwards trustedMode:true so the gate can auto-apply the PC consequence', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));
    await tools.handleApplyDamage({
      tokenId: 'pc1',
      damage: [{ value: 8, type: 'slashing' }],
      trustedMode: true,
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.applyDamage',
      expect.objectContaining({ trustedMode: true })
    );
  });

  it('defaults trustedMode to false when omitted', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));
    await tools.handleApplyDamage({ tokenId: 'pc1', damage: [{ value: 1, type: 'fire' }] });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.applyDamage',
      expect.objectContaining({ trustedMode: false })
    );
  });
});

describe('apply-damage — invalid target', () => {
  it('throws, never a silent success', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(
      tools.handleApplyDamage({ tokenId: 'ghost', damage: [{ value: 1, type: 'fire' }] })
    ).rejects.toThrow(/invalid target/i);
  });
});

describe('apply-damage — schema validation', () => {
  it('rejects an empty damage array before calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleApplyDamage({ tokenId: 'npc1', damage: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a damage entry missing a type', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleApplyDamage({ tokenId: 'npc1', damage: [{ value: 5 }] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
