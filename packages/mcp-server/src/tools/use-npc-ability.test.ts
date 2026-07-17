/**
 * Unit tests for TokenManipulationTools.handleUseNpcAbility (T33,
 * npc_use_ability).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §5.2/§5.3 + §3 (action category).
 * The actual attack/save Activity firing (`{configure:false}`, no dialog)
 * lives inside Foundry/dnd5e and needs a live world (V1 B2 already confirmed
 * a goblin Scimitar activity firing live with no dialog). What this layer
 * owns and what's testable here without Foundry:
 *  - tokenId/itemIdentifier/targetTokenIds are forwarded verbatim.
 *  - a PC-actor gate rejection surfaces as a thrown error, never a silent
 *    success — with no trustedMode escape hatch (D2 is unconditional, unlike
 *    a consequence).
 *  - an invalid target surfaces as a thrown error, never a silent success.
 * Live activity-firing / PC-save-handoff confirmation is folded into T-INT
 * (D12), not here — same deferral pattern as T31/T32/T-ADV.
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

describe('use-npc-ability — NPC actor (auto)', () => {
  it('forwards tokenId/itemIdentifier/targetTokenIds verbatim', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      itemName: 'Scimitar',
      activityType: 'attack',
      targets: ['pc1'],
      pcSaveRequested: null,
      chatMessageCreated: true,
    }));

    const result: any = await tools.handleUseNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['pc1'],
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.executeNpcAbility', {
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['pc1'],
    });
    expect(result.success).toBe(true);
    expect(result.activityType).toBe('attack');
  });

  it('reports a pending PC-save handoff without resolving it', async () => {
    const { tools } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      itemName: 'Hold Person',
      activityType: 'save',
      targets: ['pc1'],
      pcSaveRequested: { targetName: 'TestPC', ability: 'wis' },
      chatMessageCreated: true,
    }));

    const result: any = await tools.handleUseNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Hold Person',
      targetTokenIds: ['pc1'],
    });

    expect(result.pcSaveRequested).toEqual({ targetName: 'TestPC', ability: 'wis' });
  });
});

describe('use-npc-ability — PC actor (barred, D2)', () => {
  it('throws on a gate rejection instead of silently succeeding', async () => {
    const { tools, query } = makeTools(async () => ({
      success: false,
      error: 'pc_actor_barred',
      tokenId: 'pc1',
    }));

    await expect(
      tools.handleUseNpcAbility({ tokenId: 'pc1', itemIdentifier: 'Longsword' })
    ).rejects.toThrow(/pc_actor_barred/);

    // No trustedMode param exists on this tool at all — D2 is unconditional.
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.executeNpcAbility',
      expect.not.objectContaining({ trustedMode: expect.anything() })
    );
  });
});

describe('use-npc-ability — invalid target', () => {
  it('throws, never a silent success', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(
      tools.handleUseNpcAbility({ tokenId: 'ghost', itemIdentifier: 'Claw' })
    ).rejects.toThrow(/invalid target/i);
  });
});

describe('use-npc-ability — schema validation', () => {
  it('rejects a missing itemIdentifier before calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleUseNpcAbility({ tokenId: 'npc1' } as any)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
