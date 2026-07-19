import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface TokenManipulationToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class TokenManipulationTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: TokenManipulationToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'TokenManipulationTools' });
  }

  /**
   * Tool definitions for token manipulation operations
   */
  getToolDefinitions() {
    return [
      {
        name: 'move-token',
        description:
          'Move a token to a new position on the current scene. Can optionally animate the movement.',
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The ID of the token to move',
            },
            x: {
              type: 'number',
              description: 'The new X coordinate (in pixels)',
            },
            y: {
              type: 'number',
              description: 'The new Y coordinate (in pixels)',
            },
            animate: {
              type: 'boolean',
              description: 'Whether to animate the movement (default: false)',
              default: false,
            },
          },
          required: ['tokenId', 'x', 'y'],
        },
      },
      {
        name: 'update-token',
        description:
          'Update various properties of a token such as visibility, disposition, size, rotation, elevation, or name',
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The ID of the token to update',
            },
            updates: {
              type: 'object',
              description: 'Object containing the properties to update',
              properties: {
                x: {
                  type: 'number',
                  description: 'New X coordinate',
                },
                y: {
                  type: 'number',
                  description: 'New Y coordinate',
                },
                width: {
                  type: 'number',
                  description: 'New width in grid units',
                },
                height: {
                  type: 'number',
                  description: 'New height in grid units',
                },
                rotation: {
                  type: 'number',
                  description: 'New rotation in degrees (0-360)',
                },
                hidden: {
                  type: 'boolean',
                  description: 'Whether the token is hidden from players',
                },
                disposition: {
                  type: 'number',
                  description: 'Token disposition: -1 (hostile), 0 (neutral), 1 (friendly)',
                  enum: [-1, 0, 1],
                },
                name: {
                  type: 'string',
                  description: 'New display name for the token',
                },
                elevation: {
                  type: 'number',
                  description: 'Elevation in distance units',
                },
                lockRotation: {
                  type: 'boolean',
                  description: 'Whether to lock the rotation',
                },
              },
            },
          },
          required: ['tokenId', 'updates'],
        },
      },
      {
        name: 'delete-tokens',
        description: 'Delete one or more tokens from the current scene',
        inputSchema: {
          type: 'object',
          properties: {
            tokenIds: {
              type: 'array',
              description: 'Array of token IDs to delete',
              items: {
                type: 'string',
              },
              minItems: 1,
            },
          },
          required: ['tokenIds'],
        },
      },
      {
        name: 'get-token-details',
        description:
          'Get detailed information about a specific token including all properties and linked actor data',
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The ID of the token to get details for',
            },
          },
          required: ['tokenId'],
        },
      },
      {
        name: 'toggle-token-condition',
        description:
          'Toggle a status effect/condition on or off for a token. Use this to apply or remove conditions like Prone, Poisoned, Blinded, etc. Targeting an NPC/monster applies immediately. Targeting the PC returns a needs_approval response (D4) unless trustedMode is set, in which case it applies automatically — the DM owns PC consequences (HP, conditions). Pass durationRounds for a save-ends/timed condition (a bare toggle otherwise carries no duration).',
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The ID of the token to modify',
            },
            conditionId: {
              type: 'string',
              description:
                'The ID of the condition/status effect to toggle (e.g., "prone", "poisoned", "blinded")',
            },
            active: {
              type: 'boolean',
              description:
                'Optional: true to add the condition, false to remove it. If not specified, will toggle the current state.',
            },
            durationRounds: {
              type: 'number',
              description:
                'Optional: for a save-ends or otherwise timed condition, the number of rounds the effect lasts. Only meaningful when active is true.',
            },
            trustedMode: {
              type: 'boolean',
              description:
                'Set true only when the session header declares trusted mode. Lets a PC-target condition auto-apply instead of returning needs_approval.',
              default: false,
            },
          },
          required: ['tokenId', 'conditionId'],
        },
      },
      {
        name: 'get-available-conditions',
        description:
          'Get a list of all available status effects/conditions that can be applied to tokens in the current game system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'enroll-tokens-in-combat',
        description:
          'Enroll one or more NPC/monster tokens into the active combat (creating a combat on the current scene if none exists). NPC-side only: a player-owned (PC) token is rejected — the player enrolls the PC themselves. Returns the combat id and the enrolled { tokenId, combatantId } pairs. Roll their initiative afterwards with roll-npc-initiative.',
        inputSchema: {
          type: 'object',
          properties: {
            tokenIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'The scene token IDs of the NPC tokens to add to combat.',
            },
          },
          required: ['tokenIds'],
        },
      },
      {
        name: 'roll-npc-initiative',
        description:
          "Roll initiative for NPC combatants in the active combat. With combatantIds, rolls for exactly those; without, rolls for every NPC that has no initiative yet (native rollNPC). Returns the current initiative order. NPC-side only — the player rolls the PC's initiative in Foundry.",
        inputSchema: {
          type: 'object',
          properties: {
            combatantIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional: specific combatant IDs to roll. Omit to roll all NPCs missing initiative.',
            },
          },
        },
      },
      {
        name: 'apply-damage',
        description:
          "Apply typed damage (or healing, via a damage entry with type:\"healing\") to a token's HP. Runs the target's native resistance/vulnerability/immunity and temp-HP math (the same path the chat-card 'apply damage' button uses) — never a raw HP write. Targeting an NPC/monster applies immediately. Targeting the PC returns a needs_approval response (D4) unless trustedMode is set, in which case it applies automatically (the DM owns PC consequences; PC decisions like movement and rolls are never auto-applied). Damage must be passed explicitly as typed entries — this tool never parses a chat card. Dropping an NPC to 0 HP auto-flags its combatant defeated (defeatedFlagged:true) if it's in the active combat; PCs are never auto-flagged.",
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The scene token ID to damage or heal.',
            },
            damage: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  value: { type: 'number', description: 'Damage amount (positive).' },
                  type: {
                    type: 'string',
                    description: 'Damage type, e.g. "slashing", "fire", "cold".',
                  },
                },
                required: ['value', 'type'],
              },
              description: 'One or more typed damage entries to apply.',
            },
            multiplier: {
              type: 'number',
              description:
                'Damage multiplier, must be >= 0 (default 1). To heal, pass a damage entry with type:"healing" instead — a negative multiplier is rejected, since it would double-negate healing entries into damage.',
              default: 1,
            },
            trustedMode: {
              type: 'boolean',
              description:
                'Set true only when the session header declares trusted mode. Lets a PC-target consequence auto-apply instead of returning needs_approval. Never set for PC decisions (movement/rolls) — those are barred regardless.',
              default: false,
            },
          },
          required: ['tokenId', 'damage'],
        },
      },
      {
        name: 'advance-turn',
        description:
          "Advance the active combat to the next combatant's turn (native nextTurn). Pure NPC-side turn bookkeeping — no target, no approval. Honors Foundry's skipDefeated setting, so dead combatants are skipped automatically. Never use this to take, skip, or resolve the PC's own turn: the player always takes their turn in Foundry (D2). Returns the previous and current combatant plus the round.",
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'use-npc-ability',
        description:
          "Fire an NPC's attack or spell through its attack/save Activity (no GM dialog). For an ATTACK, this fast-forwards the d20 attack roll AND, on a hit (attack total vs each target's AC; a natural 20 always hits + crits, a natural 1 always misses), auto-rolls damage and applies it to that target through the same gate as apply-damage: an NPC target takes it automatically, a PC target returns needs_approval (D4) unless trustedMode — a miss applies nothing. The per-target outcome is in the response's `results` array (hit/crit, damage, decision). This is NOT use-item: use-item forces a configuration dialog and returns requiresGMInteraction, this tool does not. NPC-only as the actor: a PC token as the acting actor is rejected outright regardless of trustedMode (D2 — Claude never fires the PC's own items). Conditions and save effects are still NOT auto-applied — follow up with toggle-token-condition under its own gate. If the fired ability is a SAVE (not an attack) and a target is the PC, this tool automatically posts a roll request to the player via request-player-rolls instead of rolling the PC's save itself (D2) — the response's pcSaveRequested field reports this.",
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The scene token ID of the NPC using the ability (the acting actor).',
            },
            itemIdentifier: {
              type: 'string',
              description: "The item's ID or name on the NPC's actor (the attack/spell to fire).",
            },
            targetTokenIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional: scene token IDs to target (sets canvas targets before firing, the v14 canvas.tokens.setTargets path).',
            },
            trustedMode: {
              type: 'boolean',
              description:
                'Set true only when the session header declares trusted mode. Lets auto-damage on a PC target apply automatically instead of returning needs_approval. Never affects the acting-token gate — a PC actor is always barred (D2).',
              default: false,
            },
          },
          required: ['tokenId', 'itemIdentifier'],
        },
      },
      {
        name: 'tick-persistent-aoe',
        description:
          "Apply a persistent-AoE template's damage/condition to every token currently inside it (native template occupancy test, e.g. Cloud of Daggers). Call this on entry into the zone and again at the start of each creature's turn per the effect's trigger — NOT at end of turn. NPC occupants apply immediately. A PC occupant returns needs_approval (D4) unless trustedMode, in which case it applies automatically — landing in the zone is a consequence the DM owns. Returns one entry per occupant found, each reporting its own decision (auto / needs_approval / invalid_target).",
        inputSchema: {
          type: 'object',
          properties: {
            templateId: {
              type: 'string',
              description: 'The scene MeasuredTemplate ID of the active persistent-AoE zone.',
            },
            damage: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  value: { type: 'number', description: 'Damage amount (positive).' },
                  type: { type: 'string', description: 'Damage type, e.g. "cold", "fire".' },
                },
                required: ['value', 'type'],
              },
              description: 'Optional: typed damage entries to apply to each occupant.',
            },
            conditionId: {
              type: 'string',
              description: 'Optional: a condition to apply to each occupant (e.g. "poisoned").',
            },
            durationRounds: {
              type: 'number',
              description: 'Optional: duration in rounds for the applied condition, if any.',
            },
            trustedMode: {
              type: 'boolean',
              description:
                'Set true only when the session header declares trusted mode. Lets a PC occupant auto-apply instead of returning needs_approval.',
              default: false,
            },
          },
          required: ['templateId'],
        },
      },
      {
        name: 'resolve-npc-save-ends',
        description:
          "Roll an NPC's pending save-ends save server-side (no dialog) and clear the condition automatically on success. NPC-only: a PC target is rejected outright regardless of trustedMode — Claude never rolls the PC's save (D2); the player rolls their own save-ends saves and Claude just reads the result. Use on the NPC's turn, per the condition's trigger (e.g. Hold Person rolls each turn; Sleep does not roll and wakes on damage/an ally's action instead — do not call this for triggers like that).",
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: {
              type: 'string',
              description: 'The scene token ID of the NPC whose save is being rolled.',
            },
            conditionId: {
              type: 'string',
              description: 'The condition to clear if the save succeeds (e.g. "hold-person").',
            },
            ability: {
              type: 'string',
              description: 'The saving-throw ability abbreviation, e.g. "con", "wis".',
            },
            dc: {
              type: 'number',
              description: 'The save DC to beat.',
            },
          },
          required: ['tokenId', 'conditionId', 'ability', 'dc'],
        },
      },
    ];
  }

  // T32: move a token, grid-snapped. NPC target applies immediately; a PC
  // target is REJECTED outright (category 'decision', D2 — movement stays a
  // player decision even under trusted mode). The Foundry side gates and
  // snaps; this handler surfaces a gate rejection as an error rather than a
  // silent success (SPEC §3: "never a silent write").
  async handleMoveToken(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
      x: z.number(),
      y: z.number(),
      animate: z.boolean().optional().default(false),
    });

    const { tokenId, x, y, animate } = schema.parse(args);

    this.logger.info('Moving token', { tokenId, x, y, animate });

    try {
      const result: any = await this.foundryClient.query('foundry-mcp-bridge.move-token', {
        tokenId,
        x,
        y,
        animate,
      });

      if (result && result.success === false) {
        this.logger.warn('Move token rejected by target-check', result);
        throw new Error(`Cannot move token ${result.tokenId ?? tokenId}: ${result.error}`);
      }

      this.logger.debug('Token moved successfully', { tokenId });

      return {
        success: true,
        tokenId,
        previousPosition: result?.previousPosition,
        newPosition: result?.newPosition ?? { x, y },
        requestedPosition: { x, y },
        animated: animate,
      };
    } catch (error) {
      this.logger.error('Failed to move token', error);
      throw new Error(
        `Failed to move token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T32: `hidden` is the WRITE side of D8 and is gated (category 'decision') —
  // an NPC target applies immediately; a PC target is REJECTED outright (never
  // hide a player's own token from them). Other update fields are unrelated to
  // T32 and stay ungated, unchanged from prior behavior.
  async handleUpdateToken(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
      updates: z.object({
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        rotation: z.number().min(0).max(360).optional(),
        hidden: z.boolean().optional(),
        disposition: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
        name: z.string().optional(),
        elevation: z.number().optional(),
        lockRotation: z.boolean().optional(),
      }),
    });

    const { tokenId, updates } = schema.parse(args);

    this.logger.info('Updating token', { tokenId, updates });

    try {
      const result: any = await this.foundryClient.query('foundry-mcp-bridge.update-token', {
        tokenId,
        updates,
      });

      if (result && result.success === false) {
        this.logger.warn('Update token rejected by target-check', result);
        throw new Error(`Cannot update token ${result.tokenId ?? tokenId}: ${result.error}`);
      }

      this.logger.debug('Token updated successfully', { tokenId, result });

      return {
        success: true,
        tokenId,
        updated: true,
        appliedUpdates: updates,
      };
    } catch (error) {
      this.logger.error('Failed to update token', error);
      throw new Error(
        `Failed to update token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleDeleteTokens(args: any): Promise<any> {
    const schema = z.object({
      tokenIds: z.array(z.string()).min(1),
    });

    const { tokenIds } = schema.parse(args);

    this.logger.info('Deleting tokens', { count: tokenIds.length, tokenIds });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.delete-tokens', {
        tokenIds,
      });

      this.logger.debug('Tokens deleted successfully', {
        deleted: result.deletedCount,
        requested: tokenIds.length,
      });

      return {
        success: result.success,
        deletedCount: result.deletedCount,
        tokenIds: result.tokenIds,
        errors: result.errors,
      };
    } catch (error) {
      this.logger.error('Failed to delete tokens', error);
      throw new Error(
        `Failed to delete tokens: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetTokenDetails(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
    });

    const { tokenId } = schema.parse(args);

    this.logger.info('Getting token details', { tokenId });

    try {
      const tokenData = await this.foundryClient.query('foundry-mcp-bridge.get-token-details', {
        tokenId,
      });

      this.logger.debug('Retrieved token details', {
        tokenId,
        hasActorData: !!tokenData.actorData,
      });

      return this.formatTokenDetails(tokenData);
    } catch (error) {
      this.logger.error('Failed to get token details', error);
      throw new Error(
        `Failed to get token details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private formatTokenDetails(tokenData: any): any {
    return {
      id: tokenData.id,
      name: tokenData.name,
      position: {
        x: tokenData.x,
        y: tokenData.y,
      },
      size: {
        width: tokenData.width,
        height: tokenData.height,
      },
      appearance: {
        rotation: tokenData.rotation,
        scale: tokenData.scale,
        alpha: tokenData.alpha,
        hidden: tokenData.hidden,
        img: tokenData.img,
      },
      behavior: {
        disposition: this.getDispositionName(tokenData.disposition),
        elevation: tokenData.elevation,
        lockRotation: tokenData.lockRotation,
      },
      actor: tokenData.actorData
        ? {
            id: tokenData.actorId,
            name: tokenData.actorData.name,
            type: tokenData.actorData.type,
            img: tokenData.actorData.img,
            isLinked: tokenData.actorLink,
          }
        : null,
    };
  }

  private getDispositionName(disposition: number): string {
    switch (disposition) {
      case -1:
        return 'hostile';
      case 0:
        return 'neutral';
      case 1:
        return 'friendly';
      default:
        return 'unknown';
    }
  }

  // T34: NPC target applies immediately; PC target returns a needs_approval
  // payload (D4) unless trustedMode is set (category 'consequence', same
  // shape as apply-damage). Does NOT throw on needs_approval — that is a
  // valid, defined outcome the DM must see and act on, not a tool failure.
  async handleToggleTokenCondition(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
      conditionId: z.string(),
      active: z.boolean().optional(),
      durationRounds: z.number().optional(),
      trustedMode: z.boolean().optional().default(false),
    });

    const { tokenId, conditionId, active, durationRounds, trustedMode } = schema.parse(args);

    this.logger.info('Toggling token condition', {
      tokenId,
      conditionId,
      active,
      durationRounds,
      trustedMode,
    });

    try {
      const result: any = await this.foundryClient.query(
        'foundry-mcp-bridge.toggle-token-condition',
        { tokenId, conditionId, active, durationRounds, trustedMode }
      );

      if (result && result.success === false && result.error === 'invalid_target') {
        this.logger.warn('toggle-token-condition: invalid target', result);
        throw new Error(`Cannot toggle condition: invalid target ${result.tokenId ?? tokenId}`);
      }
      if (result && result.status === 'needs_approval') {
        this.logger.info('toggle-token-condition: PC target needs approval', result);
        return result; // pass the D4 approval-request shape straight through
      }

      this.logger.debug('Token condition toggled successfully', { tokenId, conditionId, result });

      return {
        success: true,
        tokenId,
        conditionId,
        isActive: result.isActive,
        conditionName: result.conditionName,
        durationRounds: result.durationRounds ?? null,
      };
    } catch (error) {
      this.logger.error('Failed to toggle token condition', error);
      throw new Error(
        `Failed to toggle token condition: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T33 (+ T33-FIX): fire an NPC's attack/spell via the attack/save Activity
  // (no dialog); an attack auto-rolls + applies damage on hit through the gate.
  // NPC-only as the acting actor — a PC-actor gate rejection surfaces as a
  // thrown error, never a silent success. `trustedMode` governs ONLY auto-damage
  // on a PC target (consequence); the acting-token gate is unconditional (D2:
  // a PC actor is always barred, trusted or not).
  async handleUseNpcAbility(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
      itemIdentifier: z.string(),
      targetTokenIds: z.array(z.string()).optional(),
      trustedMode: z.boolean().optional().default(false),
    });

    const { tokenId, itemIdentifier, targetTokenIds, trustedMode } = schema.parse(args);

    this.logger.info('Using NPC ability', { tokenId, itemIdentifier, targetTokenIds, trustedMode });

    try {
      const result: any = await this.foundryClient.query('foundry-mcp-bridge.executeNpcAbility', {
        tokenId,
        itemIdentifier,
        targetTokenIds,
        trustedMode,
      });

      if (result && result.success === false && result.error === 'invalid_target') {
        this.logger.warn('use-npc-ability: invalid target', result);
        throw new Error(`Cannot use ability: invalid target ${result.tokenId ?? tokenId}`);
      }
      if (result && result.success === false) {
        this.logger.warn('use-npc-ability rejected by target-check', result);
        throw new Error(
          `Cannot use ability for token ${result.tokenId ?? tokenId}: ${result.error}`
        );
      }

      this.logger.debug('NPC ability fired', { tokenId, itemIdentifier, result });
      return result;
    } catch (error) {
      this.logger.error('Failed to use NPC ability', error);
      throw new Error(
        `Failed to use NPC ability: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T35 (conditional, gate passed via live probe 2026-07-17): tick a
  // persistent-AoE template's occupants. No single acting/target token for
  // this call itself (category 'bookkeeping', SPEC §3.1) — each occupant is
  // individually gated server-side and reported per-entry, so this handler
  // does NOT throw on a per-occupant needs_approval/rejected — it passes the
  // full occupants array straight through for the DM to act on.
  async handleTickPersistentAoe(args: any): Promise<any> {
    const schema = z.object({
      templateId: z.string(),
      damage: z.array(z.object({ value: z.number(), type: z.string() })).optional(),
      conditionId: z.string().optional(),
      durationRounds: z.number().optional(),
      trustedMode: z.boolean().optional().default(false),
    });

    const { templateId, damage, conditionId, durationRounds, trustedMode } = schema.parse(args);

    this.logger.info('Ticking persistent AoE template', {
      templateId,
      damage,
      conditionId,
      durationRounds,
      trustedMode,
    });

    try {
      const result: any = await this.foundryClient.query(
        'foundry-mcp-bridge.tickPersistentAoeTemplate',
        { templateId, damage, conditionId, durationRounds, trustedMode }
      );

      this.logger.debug('Persistent AoE tick resolved', {
        templateId,
        occupantCount: result?.occupants?.length,
      });
      return result;
    } catch (error) {
      this.logger.error('Failed to tick persistent AoE template', error);
      throw new Error(
        `Failed to tick persistent AoE template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T34: roll an NPC's save-ends save and clear the condition on success.
  // NPC-only — a PC target is rejected outright (category 'action', D2:
  // Claude never rolls the PC's save). Surfaces a gate rejection as an error
  // rather than a silent success.
  async handleResolveNpcSaveEnds(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
      conditionId: z.string(),
      ability: z.string(),
      dc: z.number(),
    });

    const { tokenId, conditionId, ability, dc } = schema.parse(args);

    this.logger.info('Resolving NPC save-ends condition', { tokenId, conditionId, ability, dc });

    try {
      const result: any = await this.foundryClient.query(
        'foundry-mcp-bridge.resolveSaveEndsCondition',
        { tokenId, conditionId, ability, dc }
      );

      if (result && result.success === false && result.error === 'invalid_target') {
        this.logger.warn('resolve-npc-save-ends: invalid target', result);
        throw new Error(`Cannot resolve save-ends: invalid target ${result.tokenId ?? tokenId}`);
      }
      if (result && result.success === false) {
        this.logger.warn('resolve-npc-save-ends rejected by target-check', result);
        throw new Error(
          `Cannot resolve save-ends for token ${result.tokenId ?? tokenId}: ${result.error}`
        );
      }

      this.logger.debug('NPC save-ends resolved', { tokenId, result });
      return result;
    } catch (error) {
      this.logger.error('Failed to resolve NPC save-ends condition', error);
      throw new Error(
        `Failed to resolve NPC save-ends condition: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetAvailableConditions(args: any): Promise<any> {
    this.logger.info('Getting available conditions');

    try {
      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.get-available-conditions',
        {}
      );

      this.logger.debug('Retrieved available conditions', { count: result.conditions?.length });

      return {
        success: true,
        conditions: result.conditions,
        gameSystem: result.gameSystem,
      };
    } catch (error) {
      this.logger.error('Failed to get available conditions', error);
      throw new Error(
        `Failed to get available conditions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T-SETUP: enroll NPC tokens into combat. The Foundry side gates each token
  // (rejects a PC token / invalid target); this handler passes the result
  // through, surfacing a gate error as an error rather than a silent success.
  async handleEnrollTokensInCombat(args: any): Promise<any> {
    const schema = z.object({ tokenIds: z.array(z.string()).min(1) });
    const { tokenIds } = schema.parse(args);

    this.logger.info('Enrolling tokens in combat', { tokenIds });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.enrollTokensInCombat', {
        tokenIds,
      });

      if (result && (result as any).success === false) {
        this.logger.warn('Enroll rejected by gate', result);
        throw new Error(
          `Cannot enroll token ${(result as any).tokenId ?? ''}: ${(result as any).error}`
        );
      }

      this.logger.debug('Tokens enrolled', { tokenIds });
      return result;
    } catch (error) {
      this.logger.error('Failed to enroll tokens in combat', error);
      throw new Error(
        `Failed to enroll tokens in combat: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T-SETUP: roll NPC initiative in the active combat.
  async handleRollNpcInitiative(args: any): Promise<any> {
    const schema = z.object({ combatantIds: z.array(z.string()).optional() });
    const { combatantIds } = schema.parse(args ?? {});

    this.logger.info('Rolling NPC initiative', { combatantIds });

    try {
      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.rollNpcInitiative',
        combatantIds ? { combatantIds } : {}
      );
      this.logger.debug('NPC initiative rolled');
      return result;
    } catch (error) {
      this.logger.error('Failed to roll NPC initiative', error);
      throw new Error(
        `Failed to roll NPC initiative: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T31: apply typed damage/healing. NPC target applies immediately; PC target
  // returns a needs_approval payload (D4) unless trustedMode is set. This
  // handler does NOT throw on needs_approval/rejected/invalid_target — those
  // are valid, defined outcomes the DM must see and act on, not tool failures.
  async handleApplyDamage(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
      damage: z.array(z.object({ value: z.number(), type: z.string() })).min(1),
      multiplier: z.number().optional().default(1),
      trustedMode: z.boolean().optional().default(false),
    });

    const { tokenId, damage, multiplier, trustedMode } = schema.parse(args);

    this.logger.info('Applying damage', { tokenId, damage, multiplier, trustedMode });

    try {
      const result: any = await this.foundryClient.query('foundry-mcp-bridge.applyDamage', {
        tokenId,
        damage,
        multiplier,
        trustedMode,
      });

      if (result && result.success === false && result.error === 'invalid_target') {
        this.logger.warn('apply-damage: invalid target', result);
        throw new Error(`Cannot apply damage: invalid target ${result.tokenId ?? tokenId}`);
      }
      if (result && result.status === 'needs_approval') {
        this.logger.info('apply-damage: PC target needs approval', result);
        return result; // pass the D4 approval-request shape straight through
      }

      this.logger.debug('Damage applied', { tokenId });
      return result;
    } catch (error) {
      this.logger.error('Failed to apply damage', error);
      throw new Error(
        `Failed to apply damage: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // T-ADV: advance the active combat to the next turn. Pure NPC-side turn
  // bookkeeping — no target, no gate, no approval (SPEC §3.1). Takes no args.
  async handleAdvanceTurn(_args: any): Promise<any> {
    this.logger.info('Advancing turn');

    try {
      const result: any = await this.foundryClient.query('foundry-mcp-bridge.advanceTurn', {});
      this.logger.debug('Turn advanced', { current: result?.current?.combatantId });
      return result;
    } catch (error) {
      this.logger.error('Failed to advance turn', error);
      throw new Error(
        `Failed to advance turn: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
