// Shared TARGET-CHECK module (T-GATE)
//
// The single gate every NPC-write verb calls before it writes. Frozen contract:
// /bridge/npc-write-layer-SPEC.md §3 (the check) + §4 (the D4 approval shape).
//
// Three-layer firewall, layer 2 (SPEC §2 of D10): Foundry ownership is the real
// stop; this bridge-side check stops Claude crossing to the PC; narration/D8 is
// layer 3. This module is layer 2 and NOTHING else — it classifies a target and
// returns a verdict; it performs no write itself.
//
// Design notes:
// - Token resolution is INJECTED (`resolveToken`) so the classifier is pure and
//   unit-testable without a live Foundry `canvas`/`game`. The verb passes a
//   resolver that does `canvas.tokens.get(id)` and hands back the synthetic
//   `token.actor` (never the world actor looked up by name — keeps identical
//   unlinked NPCs independent; SPEC §3 rule 1, V1 A3/#7).
// - Trusted mode is a SESSION-HEADER posture (D4 addendum), declared by the
//   caller, NOT read from a Foundry setting. The verb passes `trustedMode` from
//   the query data. The gate never auto-grants trusted mode on its own.

export type VerbCategory =
  // PC-affecting consequence the DM owns (HP, conditions). PC target → D4 gate,
  // or auto under trusted mode.
  | 'consequence'
  // NPC-side bookkeeping with no PC target (advance turn, AoE tick). PC target
  // never occurs; if one is passed it is treated as invalid.
  | 'bookkeeping'
  // PC DECISION the player owns (move the PC, roll/spend the PC's resources).
  // PC target → REJECT even under trusted mode (D2 is never overridden).
  | 'decision'
  // An NPC action (attack/ability). A PC as the ACTING actor → REJECT (D2 —
  // Claude never fires the PC's items). A PC as the recipient of an NPC attack
  // is handled by the consequence path (the damage lands as a consequence), so
  // the acting actor passed here is always the NPC.
  | 'action'
  // Combat setup (place/enroll/roll-initiative), NPC-side only. Any PC target →
  // REJECT.
  | 'setup';

export type TargetVerdict =
  | { decision: 'auto'; token_id: string }
  | { decision: 'needs_approval'; token_id: string; approval: ApprovalRequest }
  | { decision: 'rejected'; token_id: string; error: 'pc_decision_barred' | 'pc_actor_barred' }
  | { decision: 'invalid_target'; token_id: string; error: 'invalid_target' };

// The single shared D4 approval-request shape (SPEC §4). Built once here, reused
// by every consequence verb. `proposed` is applied verbatim on approval.
export interface ApprovalRequest {
  ok: false;
  status: 'needs_approval';
  verb: string;
  target: { token_id: string; name: string | null; is_pc: true };
  proposed: Record<string, unknown>;
  reason: string;
}

// What the injected resolver returns for a token. `null` → unresolvable/absent.
export interface ResolvedTarget {
  token_id: string;
  name: string | null;
  // true iff the synthetic token.actor is player-owned (SPEC §3 rule 2:
  // token.actor.hasPlayerOwner). A PC token.
  isPC: boolean;
}

export interface TargetCheckInput {
  token_id: string;
  verb: string; // tool name, surfaced in the approval shape
  category: VerbCategory;
  trustedMode: boolean; // session-header posture (D4 addendum)
  // The payload applied verbatim on approval (consequence verbs). Ignored for
  // non-consequence categories.
  proposed?: Record<string, unknown>;
  // Injected token resolver. Returns null for an unresolvable/absent target.
  resolveToken: (token_id: string) => ResolvedTarget | null;
}

/**
 * Classify a write target and return a verdict. Pure given `resolveToken`.
 * Resolution order is fixed (SPEC §3):
 *   1. resolve → invalid-target branch on null (never a silent write).
 *   2. NPC target → auto.
 *   3. PC target → branch by verb category.
 */
export function checkTarget(input: TargetCheckInput): TargetVerdict {
  const { token_id, verb, category, trustedMode, proposed } = input;

  // 1. Resolve. Unresolvable/absent → defined error, never a silent write.
  const target = input.resolveToken(token_id);
  if (!target) {
    return { decision: 'invalid_target', token_id, error: 'invalid_target' };
  }

  // 2. NPC/monster target → apply automatically (the common path).
  if (!target.isPC) {
    return { decision: 'auto', token_id };
  }

  // 3. PC target → branch by category.
  switch (category) {
    case 'decision':
      // PC movement / rolls / resource spends stay with the player — barred even
      // under trusted mode (D2 is never overridden).
      return { decision: 'rejected', token_id, error: 'pc_decision_barred' };

    case 'action':
      // A PC as the acting actor: Claude never fires the PC's items (D2).
      return { decision: 'rejected', token_id, error: 'pc_actor_barred' };

    case 'setup':
    case 'bookkeeping':
      // These are NPC-side only; a PC target is nonsensical → treat as barred.
      return { decision: 'rejected', token_id, error: 'pc_decision_barred' };

    case 'consequence':
      // DM owns PC consequences (HP, conditions). Trusted mode → auto; otherwise
      // return the D4 approval-request and write nothing until approved.
      if (trustedMode) {
        return { decision: 'auto', token_id };
      }
      return {
        decision: 'needs_approval',
        token_id,
        approval: buildApprovalRequest(verb, target, proposed ?? {}),
      };
  }
}

/**
 * Build the single shared D4 approval-request shape (SPEC §4). Reused by every
 * consequence verb; do not hand-roll a per-verb shape.
 */
export function buildApprovalRequest(
  verb: string,
  target: ResolvedTarget,
  proposed: Record<string, unknown>
): ApprovalRequest {
  return {
    ok: false,
    status: 'needs_approval',
    verb,
    target: { token_id: target.token_id, name: target.name, is_pc: true },
    proposed,
    reason: 'PC-affecting write requires approval (D4)',
  };
}

/**
 * Default token resolver for live use inside a verb (SPEC §3 rule 1). Reads the
 * synthetic `token.actor` so identical unlinked NPCs stay independent. Kept out
 * of `checkTarget` so the classifier stays pure/testable.
 *
 * Not called in unit tests (they inject their own resolver); guarded so a
 * missing `canvas` never throws.
 */
export function makeLiveTokenResolver(): (token_id: string) => ResolvedTarget | null {
  return (token_id: string): ResolvedTarget | null => {
    const token = (globalThis as any).canvas?.tokens?.get?.(token_id);
    if (!token) return null;
    const actor = token.actor; // synthetic actor for unlinked tokens
    if (!actor) return null;
    return {
      token_id,
      name: token.name ?? actor.name ?? null,
      isPC: actor.hasPlayerOwner === true,
    };
  };
}

/**
 * Convenience: the GM-ownership block every token the layer CREATES must default
 * to (SPEC §3 rule 3). Used by T-SETUP; exported here so the ownership rule lives
 * with the gate.
 */
export function gmOwnershipDefault(): { default: number } {
  const NONE = (globalThis as any).CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
  return { default: NONE };
}
