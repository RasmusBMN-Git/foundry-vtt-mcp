/**
 * Unit tests for the T-SETUP combat-setup handlers on TokenManipulationTools
 * (src/tools/token-manipulation.ts): enroll-tokens-in-combat + roll-npc-initiative.
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §5.8. The Foundry side gates each
 * token (rejects a PC / invalid target); these tests assert the MCP handler
 * forwards a valid enroll, surfaces a gate rejection as a thrown error (never a
 * silent success), and forwards initiative rolls. No live Foundry — the
 * foundryClient.query is injected (matches the wfrp4e test pattern).
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

describe('enroll-tokens-in-combat', () => {
  it('forwards a valid enroll to the bridge query', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      combatId: 'cbt1',
      enrolled: [{ tokenId: 'npc1', combatantId: 'c1' }],
    }));

    const result: any = await tools.handleEnrollTokensInCombat({ tokenIds: ['npc1'] });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.enrollTokensInCombat', {
      tokenIds: ['npc1'],
    });
    expect(result.success).toBe(true);
    expect(result.enrolled).toHaveLength(1);
  });

  it('throws (never silently succeeds) when the gate rejects a PC token', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'pc_decision_barred',
      tokenId: 'pc1',
    }));

    await expect(tools.handleEnrollTokensInCombat({ tokenIds: ['pc1'] })).rejects.toThrow(
      /pc_decision_barred/
    );
  });

  it('throws on an invalid/unresolvable target', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(tools.handleEnrollTokensInCombat({ tokenIds: ['ghost'] })).rejects.toThrow(
      /invalid_target/
    );
  });

  it('rejects an empty tokenIds array at the schema', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleEnrollTokensInCombat({ tokenIds: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('roll-npc-initiative', () => {
  it('forwards specific combatantIds', async () => {
    const { tools, query } = makeTools(async () => ({ success: true, rolled: ['c1'] }));
    await tools.handleRollNpcInitiative({ combatantIds: ['c1'] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollNpcInitiative', {
      combatantIds: ['c1'],
    });
  });

  it('forwards an empty payload to roll all NPCs when no ids given', async () => {
    const { tools, query } = makeTools(async () => ({ success: true }));
    await tools.handleRollNpcInitiative({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollNpcInitiative', {});
  });
});
