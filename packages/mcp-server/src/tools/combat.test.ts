/**
 * Unit tests for CombatTools.handleWaitForTurn (src/tools/combat.ts).
 *
 * T-ID coverage: the wait_for_turn result must carry `combatant_id` + `token_id`
 * (the documented T24 contract amendment, /bridge/wait-for-turn-SPEC.md §2) so the
 * DM can map the active combatant to exactly one token. Two same-named NPCs must
 * be distinguishable by their token_id.
 *
 * The tool is a pure pass-through of the Foundry-side watcher result plus the
 * re-issue loop, so we inject a fake foundryClient.query and assert the fields
 * survive. No Foundry client is needed (matches the existing wfrp4e test pattern).
 */

import { describe, it, expect, vi } from 'vitest';
import { CombatTools } from './combat.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({})));
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  const tools = new CombatTools({ foundryClient, logger });
  return { tools, query };
}

describe('CombatTools.handleWaitForTurn — T-ID identity fields', () => {
  it('forwards combatant_id + token_id on a turn_ready result', async () => {
    const { tools } = makeTools(async () => ({
      status: 'turn_ready',
      round: 4,
      current_combatant: 'Goblin Warrior',
      combatant_id: 'cbtAAA111',
      token_id: 'XFCsmCTrr5qyjB2n',
    }));

    const result: any = await tools.handleWaitForTurn({ timeout_seconds: 5 });

    expect(result.status).toBe('turn_ready');
    expect(result.current_combatant).toBe('Goblin Warrior');
    expect(result.combatant_id).toBe('cbtAAA111');
    expect(result.token_id).toBe('XFCsmCTrr5qyjB2n');
  });

  it('distinguishes two same-named combatants by token_id', async () => {
    // Same display name, different tokens — the exact ambiguity T-ID resolves.
    const gobA = {
      status: 'turn_ready',
      round: 4,
      current_combatant: 'Goblin Warrior',
      combatant_id: 'cbtA',
      token_id: 'XFCsmCTrr5qyjB2n',
    };
    const gobB = {
      status: 'turn_ready',
      round: 5,
      current_combatant: 'Goblin Warrior',
      combatant_id: 'cbtB',
      token_id: '6levj9Ll4Z7ca7aJ',
    };

    const { tools: toolsA } = makeTools(async () => gobA);
    const { tools: toolsB } = makeTools(async () => gobB);

    const rA: any = await toolsA.handleWaitForTurn({ timeout_seconds: 5 });
    const rB: any = await toolsB.handleWaitForTurn({ timeout_seconds: 5 });

    expect(rA.current_combatant).toBe(rB.current_combatant); // same name
    expect(rA.token_id).not.toBe(rB.token_id); // distinct tokens
    expect(rA.combatant_id).not.toBe(rB.combatant_id);
  });

  it('returns null identity fields on a combat_ended result', async () => {
    const { tools } = makeTools(async () => ({
      status: 'combat_ended',
      round: null,
      current_combatant: null,
      combatant_id: null,
      token_id: null,
    }));

    const result: any = await tools.handleWaitForTurn({ timeout_seconds: 5 });

    expect(result.status).toBe('combat_ended');
    expect(result.combatant_id).toBeNull();
    expect(result.token_id).toBeNull();
  });

  it('returns null identity fields when the budget times out (still the PC turn)', async () => {
    // A 'timeout' from the Foundry side means it is still the PC's turn: no NPC
    // combatant to identify, so the fields stay null. Use a tiny budget so the
    // re-issue loop exits after one iteration.
    const { tools } = makeTools(async () => ({
      status: 'timeout',
      round: 1,
      current_combatant: 'TestPC',
      combatant_id: null,
      token_id: null,
    }));

    const result: any = await tools.handleWaitForTurn({ timeout_seconds: 1 });

    expect(result.status).toBe('timeout');
    expect(result.combatant_id).toBeNull();
    expect(result.token_id).toBeNull();
  });
});
