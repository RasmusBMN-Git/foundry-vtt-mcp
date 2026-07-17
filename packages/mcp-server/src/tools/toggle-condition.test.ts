/**
 * Unit tests for TokenManipulationTools.handleToggleTokenCondition (T34,
 * apply_condition) and handleResolveNpcSaveEnds (T34, save-ends resolution).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §5.6 + §3 (consequence / action
 * categories). The actual `toggleStatusEffect` / `rollSavingThrow` calls live
 * inside Foundry and need a live world (V1 B5 already confirmed the duration
 * read live). What this layer owns and what's testable here without Foundry:
 *  - toggle-token-condition forwards conditionId/active/durationRounds
 *    verbatim; a PC target's needs_approval response passes straight through
 *    (D4); trustedMode is forwarded so the gate can auto-apply.
 *  - resolve-npc-save-ends is NPC-only: a gate rejection (PC target) surfaces
 *    as a thrown error, never a silent success, regardless of trustedMode
 *    (there is no trustedMode param at all — Claude never rolls a PC save).
 *  - an invalid target surfaces as a thrown error, never a silent success.
 * Live duration-read / save-roll confirmation is folded into T-INT (D12).
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

describe('toggle-token-condition — NPC target (auto)', () => {
  it('forwards conditionId/active/durationRounds verbatim', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      isActive: true,
      conditionName: 'Poisoned',
      durationRounds: 3,
    }));

    const result: any = await tools.handleToggleTokenCondition({
      tokenId: 'npc1',
      conditionId: 'poisoned',
      active: true,
      durationRounds: 3,
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.toggle-token-condition', {
      tokenId: 'npc1',
      conditionId: 'poisoned',
      active: true,
      durationRounds: 3,
      trustedMode: false,
    });
    expect(result.success).toBe(true);
    expect(result.durationRounds).toBe(3);
  });

  it('omits durationRounds cleanly when not provided', async () => {
    const { tools, query } = makeTools(async () => ({ success: true, isActive: false }));
    await tools.handleToggleTokenCondition({
      tokenId: 'npc1',
      conditionId: 'prone',
      active: false,
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.toggle-token-condition',
      expect.objectContaining({ durationRounds: undefined })
    );
  });
});

describe('toggle-token-condition — PC target (D4 gate)', () => {
  it('passes a needs_approval response straight through, performing no retry/write', async () => {
    const approval = {
      ok: false,
      status: 'needs_approval',
      verb: 'apply_condition',
      target: { token_id: 'pc1', name: 'TestPC', is_pc: true },
      proposed: { conditionId: 'poisoned', active: true, durationRounds: undefined },
      reason: 'PC-affecting write requires approval (D4)',
    };
    const { tools, query } = makeTools(async () => approval);

    const result = await tools.handleToggleTokenCondition({
      tokenId: 'pc1',
      conditionId: 'poisoned',
      active: true,
    });

    expect(result).toEqual(approval);
    expect(query).toHaveBeenCalledTimes(1); // no automatic retry
  });

  it('forwards trustedMode:true so the gate can auto-apply the PC consequence', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));
    await tools.handleToggleTokenCondition({
      tokenId: 'pc1',
      conditionId: 'poisoned',
      active: true,
      trustedMode: true,
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.toggle-token-condition',
      expect.objectContaining({ trustedMode: true })
    );
  });

  it('defaults trustedMode to false when omitted', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));
    await tools.handleToggleTokenCondition({
      tokenId: 'pc1',
      conditionId: 'poisoned',
      active: true,
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.toggle-token-condition',
      expect.objectContaining({ trustedMode: false })
    );
  });
});

describe('toggle-token-condition — invalid target', () => {
  it('throws, never a silent success', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(
      tools.handleToggleTokenCondition({ tokenId: 'ghost', conditionId: 'prone', active: true })
    ).rejects.toThrow(/invalid target/i);
  });
});

describe('resolve-npc-save-ends — NPC target (auto)', () => {
  it('rolls the save and reports the clear', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      conditionId: 'hold-person',
      ability: 'wis',
      dc: 15,
      rollTotal: 17,
      saveSucceeded: true,
      conditionCleared: true,
    }));

    const result: any = await tools.handleResolveNpcSaveEnds({
      tokenId: 'npc1',
      conditionId: 'hold-person',
      ability: 'wis',
      dc: 15,
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.resolveSaveEndsCondition', {
      tokenId: 'npc1',
      conditionId: 'hold-person',
      ability: 'wis',
      dc: 15,
    });
    expect(result.saveSucceeded).toBe(true);
    expect(result.conditionCleared).toBe(true);
  });

  it('reports a failed save without clearing the condition', async () => {
    const { tools } = makeTools(async () => ({
      success: true,
      rollTotal: 8,
      saveSucceeded: false,
      conditionCleared: false,
    }));

    const result: any = await tools.handleResolveNpcSaveEnds({
      tokenId: 'npc1',
      conditionId: 'hold-person',
      ability: 'wis',
      dc: 15,
    });

    expect(result.saveSucceeded).toBe(false);
    expect(result.conditionCleared).toBe(false);
  });
});

describe('resolve-npc-save-ends — PC target (barred, D2)', () => {
  it('throws on a gate rejection instead of silently succeeding — no trustedMode escape hatch', async () => {
    const { tools, query } = makeTools(async () => ({
      success: false,
      error: 'pc_actor_barred',
      tokenId: 'pc1',
    }));

    await expect(
      tools.handleResolveNpcSaveEnds({
        tokenId: 'pc1',
        conditionId: 'hold-person',
        ability: 'wis',
        dc: 15,
      })
    ).rejects.toThrow(/pc_actor_barred/);

    // No trustedMode param exists on this tool at all.
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.resolveSaveEndsCondition',
      expect.not.objectContaining({ trustedMode: expect.anything() })
    );
  });
});

describe('resolve-npc-save-ends — invalid target', () => {
  it('throws, never a silent success', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(
      tools.handleResolveNpcSaveEnds({
        tokenId: 'ghost',
        conditionId: 'prone',
        ability: 'con',
        dc: 10,
      })
    ).rejects.toThrow(/invalid target/i);
  });
});

describe('resolve-npc-save-ends — schema validation', () => {
  it('rejects a missing dc before calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleResolveNpcSaveEnds({ tokenId: 'npc1', conditionId: 'prone', ability: 'con' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
