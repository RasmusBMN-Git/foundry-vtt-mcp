import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface CombatToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// Per-iteration Foundry-side block. Must stay safely under the connector's
// hardcoded 10s per-query timeout (wait-for-turn-SPEC.md §3); the Foundry
// watcher itself caps at 8.5s. We re-issue this short block in a loop until the
// caller's timeout_seconds budget is spent, so Claude makes ONE blocking call.
const BLOCK_SECONDS = 8;
// Contract §2: default 45, hard ceiling 45 (must return before the MCP client
// timeout).
const MAX_TIMEOUT_SECONDS = 45;

interface WaitForTurnResult {
  status: 'turn_ready' | 'timeout' | 'combat_ended';
  round: number | null;
  current_combatant: string | null;
  // T-ID: identity of the active NPC combatant so the DM can target exactly one
  // token. Populated on 'turn_ready'; null on 'timeout' / 'combat_ended'.
  // Documented T24 contract amendment — see /bridge/wait-for-turn-SPEC.md §2.
  combatant_id: string | null;
  token_id: string | null;
}

/**
 * CombatTools — the `wait_for_turn` long-poll (T26).
 *
 * Blocks until it is an NPC-owned combatant's turn (the player's turn just
 * ended), combat ends, or `timeout_seconds` elapses, then returns
 * `{ status, round, current_combatant }`. Read/wait only — no state change.
 *
 * The wake is event-driven on the Foundry side (a combat hook resolves the
 * pending query with ~0 latency). This loop only exists to work around the
 * connector's fixed 10s per-query cap: each Foundry block lasts ~8s, and we
 * re-issue it until the full budget is spent. Contract: /bridge/wait-for-turn-SPEC.md.
 */
export class CombatTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: CombatToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger;
  }

  getToolDefinitions() {
    return [
      {
        name: 'wait-for-turn',
        description:
          "Block until it is the DM's turn to act, then wake with the active combatant. Returns when an NPC-owned combatant becomes active (the player just ended their turn, or it was already an NPC turn), when combat ends, or when timeout_seconds elapses. This is the event-driven turn handoff (D3): make ONE call and wait — do not poll. Returns { status: 'turn_ready' | 'timeout' | 'combat_ended', round, current_combatant, combatant_id, token_id }. combatant_id and token_id identify exactly which token is up (they disambiguate two same-named NPCs); both are null on 'timeout' and 'combat_ended'. On 'timeout', call wait-for-turn again immediately to keep waiting. Read/wait only: it changes no state — read HP/positions/effects afterwards with the normal scene/character tools.",
        inputSchema: {
          type: 'object',
          properties: {
            timeout_seconds: {
              type: 'integer',
              description:
                'Total seconds to block before returning status "timeout". Default 45; capped at 45 to stay under the MCP client timeout.',
              default: MAX_TIMEOUT_SECONDS,
              minimum: 1,
              maximum: MAX_TIMEOUT_SECONDS,
            },
          },
        },
      },
    ];
  }

  async handleWaitForTurn(args: any): Promise<WaitForTurnResult> {
    const schema = z.object({
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_TIMEOUT_SECONDS)
        .default(MAX_TIMEOUT_SECONDS),
    });

    const { timeout_seconds } = schema.parse(args ?? {});
    const deadline = Date.now() + timeout_seconds * 1000;

    // Re-issue the short Foundry-side block until an NPC turn / combat end is
    // reached or the total budget is spent. The final 'timeout' result carries
    // the current round + combatant, so we return it as-is.
    let last: WaitForTurnResult = {
      status: 'timeout',
      round: null,
      current_combatant: null,
      combatant_id: null,
      token_id: null,
    };

    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return last;
      }

      const blockSeconds = Math.min(BLOCK_SECONDS, Math.ceil(remainingMs / 1000));

      const result = (await this.foundryClient.query('foundry-mcp-bridge.waitForTurn', {
        block_seconds: blockSeconds,
      })) as WaitForTurnResult;

      last = result;

      // Terminal states: hand back to Claude immediately.
      if (result.status === 'turn_ready' || result.status === 'combat_ended') {
        return result;
      }

      // status === 'timeout' (still the PC's turn): loop while budget remains.
      if (Date.now() >= deadline) {
        return result;
      }
    }
  }
}
