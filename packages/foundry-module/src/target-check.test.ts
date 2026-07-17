/**
 * Unit tests for the shared TARGET-CHECK module (src/target-check.ts, T-GATE).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §3 (the gate) + §4 (the D4 approval
 * shape). The classifier is pure given an injected `resolveToken`, so these tests
 * need no live Foundry.
 *
 * Coverage of the frozen branches:
 *  - NPC/monster target → auto
 *  - PC consequence → needs_approval (D4 shape); trusted mode → auto
 *  - PC decision (move) → rejected even under trusted mode (D2 not overridden)
 *  - PC-actor action (fire the PC's item) → rejected
 *  - unresolvable target → invalid_target error, never a silent write
 */

import { describe, it, expect } from 'vitest';
import { checkTarget, buildApprovalRequest } from './target-check.js';
import type { ResolvedTarget } from './target-check.js';

const NPC: ResolvedTarget = { token_id: 'npc1', name: 'Goblin Warrior', isPC: false };
const PC: ResolvedTarget = { token_id: 'pc1', name: 'TestPC', isPC: true };

// Resolver factory: maps a fixed table of token_id → ResolvedTarget; unknown → null.
function resolver(table: Record<string, ResolvedTarget>) {
  return (id: string) => table[id] ?? null;
}

const R = resolver({ npc1: NPC, pc1: PC });

describe('checkTarget — NPC target', () => {
  it('applies automatically for every verb category', () => {
    for (const category of ['consequence', 'bookkeeping', 'decision', 'action', 'setup'] as const) {
      const v = checkTarget({
        token_id: 'npc1',
        verb: 'apply_damage',
        category,
        trustedMode: false,
        resolveToken: R,
      });
      expect(v.decision).toBe('auto');
      expect(v.token_id).toBe('npc1');
    }
  });
});

describe('checkTarget — PC consequence (HP/conditions)', () => {
  it('returns needs_approval with the D4 shape when NOT trusted', () => {
    const v = checkTarget({
      token_id: 'pc1',
      verb: 'apply_damage',
      category: 'consequence',
      trustedMode: false,
      proposed: { damage: [{ value: 8, type: 'slashing' }], multiplier: 1 },
      resolveToken: R,
    });
    expect(v.decision).toBe('needs_approval');
    if (v.decision !== 'needs_approval') throw new Error('unreachable');
    expect(v.approval.ok).toBe(false);
    expect(v.approval.status).toBe('needs_approval');
    expect(v.approval.verb).toBe('apply_damage');
    expect(v.approval.target).toEqual({ token_id: 'pc1', name: 'TestPC', is_pc: true });
    expect(v.approval.proposed).toEqual({
      damage: [{ value: 8, type: 'slashing' }],
      multiplier: 1,
    });
  });

  it('auto-applies under trusted mode (D4 addendum — DM owns PC consequences)', () => {
    const v = checkTarget({
      token_id: 'pc1',
      verb: 'apply_condition',
      category: 'consequence',
      trustedMode: true,
      resolveToken: R,
    });
    expect(v.decision).toBe('auto');
  });
});

describe('checkTarget — PC decision (D2 boundary)', () => {
  it('rejects a PC move even under trusted mode', () => {
    const v = checkTarget({
      token_id: 'pc1',
      verb: 'move_token',
      category: 'decision',
      trustedMode: true, // trusted does NOT override D2
      resolveToken: R,
    });
    expect(v.decision).toBe('rejected');
    if (v.decision !== 'rejected') throw new Error('unreachable');
    expect(v.error).toBe('pc_decision_barred');
  });

  it("rejects firing the PC's own item (action with PC as actor)", () => {
    const v = checkTarget({
      token_id: 'pc1',
      verb: 'use_item',
      category: 'action',
      trustedMode: true,
      resolveToken: R,
    });
    expect(v.decision).toBe('rejected');
    if (v.decision !== 'rejected') throw new Error('unreachable');
    expect(v.error).toBe('pc_actor_barred');
  });

  it('rejects a PC target for NPC-only setup/bookkeeping verbs', () => {
    for (const category of ['setup', 'bookkeeping'] as const) {
      const v = checkTarget({
        token_id: 'pc1',
        verb: 'enroll_combatant',
        category,
        trustedMode: true,
        resolveToken: R,
      });
      expect(v.decision).toBe('rejected');
    }
  });
});

describe('checkTarget — invalid target', () => {
  it('returns invalid_target for an unresolvable token, never a silent write', () => {
    const v = checkTarget({
      token_id: 'ghost',
      verb: 'apply_damage',
      category: 'consequence',
      trustedMode: true, // even trusted must not silently write to a missing target
      resolveToken: R,
    });
    expect(v.decision).toBe('invalid_target');
    if (v.decision !== 'invalid_target') throw new Error('unreachable');
    expect(v.error).toBe('invalid_target');
  });
});

describe('buildApprovalRequest — shared D4 shape', () => {
  it('produces the exact frozen shape (SPEC §4)', () => {
    const req = buildApprovalRequest('apply_damage', PC, { foo: 'bar' });
    expect(req).toEqual({
      ok: false,
      status: 'needs_approval',
      verb: 'apply_damage',
      target: { token_id: 'pc1', name: 'TestPC', is_pc: true },
      proposed: { foo: 'bar' },
      reason: 'PC-affecting write requires approval (D4)',
    });
  });
});
