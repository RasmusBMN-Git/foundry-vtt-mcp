// Combat Turn Watcher (T25)
// Event-driven wait for the DM's cue to act: blocks until the active combatant
// is NPC-owned (the player's turn just ended), combat ends, or a short internal
// ceiling elapses. No polling — a combat hook resolves pending waiters with ~0
// latency the instant the turn flips. Contract: /bridge/wait-for-turn-SPEC.md.

export type TurnStatus = 'turn_ready' | 'timeout' | 'combat_ended';

export interface WaitForTurnResult {
  status: TurnStatus;
  round: number | null;
  current_combatant: string | null;
}

interface PendingWaiter {
  resolve: (result: WaitForTurnResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Foundry-side block ceiling. Must stay safely under the MCP connector's
// hardcoded 10s per-query timeout (wait-for-turn-SPEC.md §3). The MCP tool
// re-issues this short block in a loop until its own 45s budget is spent, so
// Claude still makes a single blocking wait_for_turn call.
const DEFAULT_BLOCK_MS = 8000;
const MAX_BLOCK_MS = 8500;

export class CombatTurnWatcher {
  private isRegistered = false;
  private pending: Set<PendingWaiter> = new Set();
  private readonly boundCheck: () => void;

  constructor() {
    this.boundCheck = () => this.checkAndResolve();
  }

  /**
   * Install combat hooks. Multiple hook names are used for cross-version
   * robustness (compat min 13 / verified 14), mirroring the multi-hook approach
   * in campaign-hooks.ts. Every combat mutation triggers one idempotent
   * re-check; duplicate fires are harmless.
   */
  register(): void {
    if (this.isRegistered) return;
    Hooks.on('combatTurnChange', this.boundCheck);
    Hooks.on('combatTurn', this.boundCheck);
    Hooks.on('combatRound', this.boundCheck);
    Hooks.on('updateCombat', this.boundCheck); // fallback: fires on every turn/round advance
    Hooks.on('deleteCombat', this.boundCheck); // combat ended / deleted
    this.isRegistered = true;
  }

  /**
   * Foundry has no Hooks.off in this module's pattern, so we resolve any
   * outstanding waiters (nothing hangs) and mark unregistered — mirrors
   * campaign-hooks.ts.
   */
  unregister(): void {
    if (!this.isRegistered) return;
    for (const waiter of this.pending) {
      clearTimeout(waiter.timer);
      waiter.resolve({ status: 'combat_ended', round: null, current_combatant: null });
    }
    this.pending.clear();
    this.isRegistered = false;
  }

  /**
   * Block until it is an NPC-owned turn, combat ends, or the short ceiling
   * elapses. Returns immediately when there is no active combat or it is
   * already an NPC turn.
   */
  waitForTurn(data?: { block_seconds?: number }): Promise<WaitForTurnResult> {
    const state = this.evaluate();
    if (!state.wait) {
      return Promise.resolve(state.result);
    }

    // It is the PC's turn: block until a hook flips state or the ceiling hits.
    const blockMs = Math.min(
      data?.block_seconds ? data.block_seconds * 1000 : DEFAULT_BLOCK_MS,
      MAX_BLOCK_MS
    );

    return new Promise<WaitForTurnResult>(resolve => {
      const waiter: PendingWaiter = {
        resolve,
        timer: setTimeout(() => {
          this.pending.delete(waiter);
          resolve({
            status: 'timeout',
            round: this.currentRound(),
            current_combatant: this.currentCombatantName(),
          });
        }, blockMs),
      };
      this.pending.add(waiter);
    });
  }

  /**
   * Hook callback: if state has flipped to an NPC turn or combat ended, resolve
   * every pending waiter. Otherwise (still the PC's turn) keep blocking.
   */
  private checkAndResolve(): void {
    if (this.pending.size === 0) return;
    const state = this.evaluate();
    if (state.wait) return;
    for (const waiter of this.pending) {
      clearTimeout(waiter.timer);
      waiter.resolve(state.result);
    }
    this.pending.clear();
  }

  /**
   * Core state read. `wait: true` means it is the PC's turn (keep blocking);
   * otherwise a terminal result is ready. NPC test per contract §2:
   * combatant.actor.hasPlayerOwner === false.
   */
  private evaluate(): { wait: true } | { wait: false; result: WaitForTurnResult } {
    const combat = (game as any).combat;
    if (!combat || !combat.started) {
      return {
        wait: false,
        result: { status: 'combat_ended', round: null, current_combatant: null },
      };
    }

    const combatant = combat.combatant;
    if (!combatant) {
      // Active combat but momentarily between combatants — keep waiting; a hook
      // will fire once a combatant becomes active.
      return { wait: true };
    }

    const isNpcTurn = combatant.actor?.hasPlayerOwner === false;
    if (isNpcTurn) {
      return {
        wait: false,
        result: {
          status: 'turn_ready',
          round: combat.round ?? null,
          current_combatant: combatant.name ?? null,
        },
      };
    }

    return { wait: true };
  }

  private currentRound(): number | null {
    return (game as any).combat?.round ?? null;
  }

  private currentCombatantName(): string | null {
    return (game as any).combat?.combatant?.name ?? null;
  }
}
