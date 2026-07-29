/**
 * Unit tests for TokenManipulationTools.handleRemoveTokenEffect (T40).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §3 (consequence category) + the T40
 * task file. This tool is the complement of toggle-token-condition — it clears a
 * NAMED ActiveEffect (spell buff / concentration). What this client layer owns
 * and is testable without a live Foundry:
 *  - it forwards tokenId/effect/trustedMode verbatim to the bridge query;
 *  - a PC target's needs_approval response passes straight through (D4), no retry;
 *  - trustedMode is forwarded so the gate can auto-apply on a PC target;
 *  - an invalid target surfaces as a thrown error, never a silent success;
 *  - a no-match name comes back as notFound:true (not an error).
 * The gate decision itself (NPC auto / PC needs_approval) is covered by
 * target-check.test.ts; the delete mechanics by the foundry-module data-access
 * test. Live removal confirmation is the T40 live re-verify.
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

describe('remove-token-effect — NPC target (auto)', () => {
  it('forwards tokenId/effect/trustedMode verbatim and reports what was removed', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      effect: 'Bless',
      removed: [{ id: 'eff1', name: 'Bless' }],
      notFound: false,
      message: 'Removed Bless from Fenn',
    }));

    const result: any = await tools.handleRemoveTokenEffect({
      tokenId: 'npc1',
      effect: 'Bless',
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.remove-token-effect', {
      tokenId: 'npc1',
      effect: 'Bless',
      trustedMode: false,
    });
    expect(result.success).toBe(true);
    expect(result.notFound).toBe(false);
    expect(result.removed).toEqual([{ id: 'eff1', name: 'Bless' }]);
  });

  it('reports notFound:true for a no-match name without throwing', async () => {
    const { tools } = makeTools(async () => ({
      success: true,
      tokenId: 'npc1',
      effect: 'Haste',
      removed: [],
      notFound: true,
      message: 'No ActiveEffect matching "Haste" on Fenn',
    }));

    const result: any = await tools.handleRemoveTokenEffect({ tokenId: 'npc1', effect: 'Haste' });

    expect(result.success).toBe(true);
    expect(result.notFound).toBe(true);
    expect(result.removed).toEqual([]);
  });
});

describe('remove-token-effect — PC target (D4 gate)', () => {
  it('passes a needs_approval response straight through, performing no retry/write', async () => {
    const approval = {
      ok: false,
      status: 'needs_approval',
      verb: 'remove_effect',
      target: { token_id: 'pc1', name: 'TestPC', is_pc: true },
      proposed: { effect: 'Bless' },
      reason: 'PC-affecting write requires approval (D4)',
    };
    const { tools, query } = makeTools(async () => approval);

    const result = await tools.handleRemoveTokenEffect({ tokenId: 'pc1', effect: 'Bless' });

    expect(result).toEqual(approval);
    expect(query).toHaveBeenCalledTimes(1); // no automatic retry
  });

  it('forwards trustedMode:true so the gate can auto-apply the PC consequence', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      removed: [],
      notFound: true,
    }));
    await tools.handleRemoveTokenEffect({ tokenId: 'pc1', effect: 'Bless', trustedMode: true });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.remove-token-effect',
      expect.objectContaining({ trustedMode: true })
    );
  });

  it('defaults trustedMode to false when omitted', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      removed: [],
      notFound: true,
    }));
    await tools.handleRemoveTokenEffect({ tokenId: 'pc1', effect: 'Bless' });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.remove-token-effect',
      expect.objectContaining({ trustedMode: false })
    );
  });
});

describe('remove-token-effect — invalid target', () => {
  it('throws, never a silent success', async () => {
    const { tools } = makeTools(async () => ({
      success: false,
      error: 'invalid_target',
      tokenId: 'ghost',
    }));

    await expect(
      tools.handleRemoveTokenEffect({ tokenId: 'ghost', effect: 'Bless' })
    ).rejects.toThrow(/invalid target/i);
  });
});

describe('remove-token-effect — schema validation', () => {
  it('rejects a missing effect before calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleRemoveTokenEffect({ tokenId: 'npc1' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
