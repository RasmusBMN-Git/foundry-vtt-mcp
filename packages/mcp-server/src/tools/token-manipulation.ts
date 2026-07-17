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
          'Toggle a status effect/condition on or off for a token. Use this to apply or remove conditions like Prone, Poisoned, Blinded, etc.',
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
    ];
  }

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
      const result = await this.foundryClient.query('foundry-mcp-bridge.move-token', {
        tokenId,
        x,
        y,
        animate,
      });

      this.logger.debug('Token moved successfully', { tokenId });

      return {
        success: true,
        tokenId,
        newPosition: { x, y },
        animated: animate,
      };
    } catch (error) {
      this.logger.error('Failed to move token', error);
      throw new Error(
        `Failed to move token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

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
      const result = await this.foundryClient.query('foundry-mcp-bridge.update-token', {
        tokenId,
        updates,
      });

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

  async handleToggleTokenCondition(args: any): Promise<any> {
    const schema = z.object({
      tokenId: z.string(),
      conditionId: z.string(),
      active: z.boolean().optional(),
    });

    const { tokenId, conditionId, active } = schema.parse(args);

    this.logger.info('Toggling token condition', { tokenId, conditionId, active });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.toggle-token-condition', {
        tokenId,
        conditionId,
        active,
      });

      this.logger.debug('Token condition toggled successfully', { tokenId, conditionId, result });

      return {
        success: true,
        tokenId,
        conditionId,
        isActive: result.isActive,
        conditionName: result.conditionName,
      };
    } catch (error) {
      this.logger.error('Failed to toggle token condition', error);
      throw new Error(
        `Failed to toggle token condition: ${error instanceof Error ? error.message : 'Unknown error'}`
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
}
