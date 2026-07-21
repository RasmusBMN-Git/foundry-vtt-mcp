/**
 * Actor Management Tools
 *
 * Generic CRUD operations for Foundry Actor documents and their embedded Items.
 * Works with any game system and any actor type — no hardcoded types.
 *
 * Actor actions:  create, update, delete
 * Item actions:   update-items, delete-items  (embedded items on an actor)
 * Listing actors is handled by the existing list-characters tool.
 * Adding items is handled by manage-world-items → add-to-actor.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import { SystemRegistry } from '../systems/system-registry.js';
import { detectGameSystem } from '../utils/system-detection.js';

// ─────────────────────────────────────────────────────────────────────────────

export interface ActorManagementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
  systemRegistry?: SystemRegistry;
}

export class ActorManagementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private systemRegistry: SystemRegistry | null;

  constructor({ foundryClient, logger, systemRegistry }: ActorManagementToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'ActorManagementTools' });
    this.systemRegistry = systemRegistry ?? null;
  }

  private async getAdapter() {
    if (!this.systemRegistry) return null;
    const gameSystem = await detectGameSystem(this.foundryClient, this.logger);
    return this.systemRegistry.getAdapter(gameSystem);
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-actors',
        description:
          'Create, update, or delete Actor documents in Foundry VTT. Works with any game system.\n' +
          '- "create": Create one or more actors of any type with arbitrary system data.\n' +
          '- "update": Update one or more existing actors by ID. Merges into existing system data.\n' +
          '- "delete": Permanently delete one or more actors by ID.\n' +
          '- "update-items": Update embedded items on an actor by item ID.\n' +
          '- "delete-items": Delete embedded items from an actor by item ID.\n' +
          '- "describe": Return system-specific actor schema notes (actor types, item restrictions,\n' +
          '  field paths, skill shorthands). Call this before creating actors in an unfamiliar system.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'update', 'delete', 'update-items', 'delete-items', 'describe'],
              description:
                'Operation to perform: "create" / "update" / "delete" actors, ' +
                '"update-items" / "delete-items" for embedded items, ' +
                'or "describe" to get system-specific schema notes.',
            },
            // ── create ──────────────────────────────────────────────────────
            actors: {
              type: 'array',
              minItems: 1,
              description:
                'Required for "create". One or more actor definitions. ' +
                'Each must have a name and a type valid for the active game system.',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Display name of the actor.',
                  },
                  type: {
                    type: 'string',
                    description:
                      'Actor type as defined by the game system ' +
                      '(e.g. "traveller", "npc", "creature", "spacecraft", "vehicle", "world").',
                  },
                  img: {
                    type: 'string',
                    description: 'Optional icon/portrait path.',
                  },
                  system: {
                    type: 'object',
                    description:
                      'System-specific data. Free-form object — use action:"describe" to get valid field names for the active system.',
                    additionalProperties: true,
                  },
                },
                required: ['name', 'type'],
              },
            },
            folder: {
              type: 'string',
              description:
                'For "create": folder name/ID to place actors in (created if absent). ' +
                'Defaults to "Foundry MCP Actors".',
            },
            // ── update ──────────────────────────────────────────────────────
            updates: {
              type: 'array',
              minItems: 1,
              description:
                'Required for "update". One or more actor patches. ' +
                'Each entry must include "id" plus at least one field to change.',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    description: 'ID of the actor to update.',
                  },
                  name: {
                    type: 'string',
                    description: 'New display name.',
                  },
                  img: {
                    type: 'string',
                    description: 'New icon/portrait path.',
                  },
                  system: {
                    type: 'object',
                    description:
                      'System-specific fields to update. Merged into the existing system data ' +
                      '(top-level keys only — nested objects replace, not merge). ' +
                      'Use action:"describe" to get valid field names for the active system.',
                    additionalProperties: true,
                  },
                },
                required: ['id'],
              },
            },
            // ── delete ──────────────────────────────────────────────────────
            ids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description: 'Required for "delete". IDs of the actors to delete.',
            },
            // ── update-items ─────────────────────────────────────────────────
            actorIdentifier: {
              type: 'string',
              description: 'Required for "update-items" and "delete-items". Actor name or ID.',
            },
            itemUpdates: {
              type: 'array',
              minItems: 1,
              description:
                'Required for "update-items". Patches for embedded items. ' +
                'Each entry must include the item "id" plus fields to change. ' +
                'The "system" object is merged at the top level.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'ID of the embedded item.' },
                  name: { type: 'string', description: 'New display name.' },
                  img: { type: 'string', description: 'New icon path.' },
                  system: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'System fields to update. Passed directly to Foundry.',
                  },
                },
                required: ['id'],
              },
            },
            // ── delete-items ─────────────────────────────────────────────────
            itemIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description: 'Required for "delete-items". IDs of the embedded items to delete.',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'place-existing-actor-token',
        description:
          "Drop a token for an EXISTING world actor onto a scene — including the player character, e.g. re-placing the PC on a freshly generated map without a manual sidebar drag. This places an actor that already exists in the world (use its actor id); it does NOT create a new actor (use manage-actors or create-actor-from-compendium for that). The placed token inherits the actor's prototype-token ownership, so a player-owned PC actor yields a player-controllable token and GM-owned NPCs stay GM-only. Give an actor_id, optionally a scene_id (defaults to the active scene), an optional x/y for exact placement (otherwise it is auto-positioned), and hidden to place it face-down. Returns { success, tokensCreated, tokenIds }.",
        inputSchema: {
          type: 'object',
          properties: {
            actor_id: {
              type: 'string',
              description: 'ID of the existing world actor to place (may be the PC actor).',
            },
            scene_id: {
              type: 'string',
              description:
                'Optional. ID of the target scene. Defaults to the currently active scene.',
            },
            x: {
              type: 'number',
              description:
                'Optional. X pixel coordinate for exact placement. Provide with y; if omitted the token is auto-positioned (centered).',
            },
            y: {
              type: 'number',
              description:
                'Optional. Y pixel coordinate for exact placement. Provide with x; if omitted the token is auto-positioned (centered).',
            },
            hidden: {
              type: 'boolean',
              description: 'Optional. Place the token hidden (GM-only). Default false.',
              default: false,
            },
          },
          required: ['actor_id'],
        },
      },
    ];
  }

  async handleManageActors(args: any): Promise<any> {
    const { action } = z
      .object({
        action: z.enum(['create', 'update', 'delete', 'update-items', 'delete-items', 'describe']),
      })
      .parse(args);

    switch (action) {
      case 'create':
        return this.handleCreate(args);
      case 'update':
        return this.handleUpdate(args);
      case 'delete':
        return this.handleDelete(args);
      case 'update-items':
        return this.handleUpdateItems(args);
      case 'delete-items':
        return this.handleDeleteItems(args);
      case 'describe':
        return this.handleDescribe();
    }
  }

  private async handleDescribe(): Promise<any> {
    const adapter = await this.getAdapter();
    const notes = adapter?.describeActorSchema?.();
    if (notes) return { schema: notes };
    return { schema: 'No system-specific actor schema notes available for the active system.' };
  }

  // ── create ────────────────────────────────────────────────────────────────

  private async handleCreate(args: any): Promise<any> {
    const schema = z.object({
      actors: z
        .array(
          z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            img: z.string().optional(),
            system: z.record(z.any()).optional(),
          })
        )
        .min(1),
      folder: z.string().optional(),
    });

    const { actors, folder } = schema.parse(args);

    this.logger.info('Creating actors', {
      count: actors.length,
      types: actors.map(a => a.type),
    });

    const adapter = await this.getAdapter();
    const normalizedActors = adapter?.normalizePayload
      ? actors.map(a =>
          a.system !== undefined ? { ...a, system: adapter.normalizePayload!(a.system) } : a
        )
      : actors;

    const result = await this.foundryClient.query('foundry-mcp-bridge.createActors', {
      actors: normalizedActors,
      folder,
    });

    return result;
  }

  // ── update ────────────────────────────────────────────────────────────────

  private async handleUpdate(args: any): Promise<any> {
    const schema = z.object({
      updates: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().optional(),
            img: z.string().optional(),
            system: z.record(z.any()).optional(),
          })
        )
        .min(1),
    });

    const { updates } = schema.parse(args);

    this.logger.info('Updating actors', { count: updates.length });

    const adapter = await this.getAdapter();
    const normalizedUpdates = adapter?.normalizePayload
      ? updates.map(u =>
          u.system !== undefined ? { ...u, system: adapter.normalizePayload!(u.system) } : u
        )
      : updates;

    const result = await this.foundryClient.query('foundry-mcp-bridge.updateActors', {
      updates: normalizedUpdates,
    });

    return result;
  }

  // ── delete ────────────────────────────────────────────────────────────────

  private async handleDelete(args: any): Promise<any> {
    const schema = z.object({
      ids: z.array(z.string().min(1)).min(1),
    });

    const { ids } = schema.parse(args);

    this.logger.info('Deleting actors', { count: ids.length });

    const result = await this.foundryClient.query('foundry-mcp-bridge.deleteActors', { ids });

    return result;
  }

  // ── update-items ────────────────────────────────────────────────────────────

  private async handleUpdateItems(args: any): Promise<any> {
    const schema = z.object({
      actorIdentifier: z.string().min(1),
      itemUpdates: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().optional(),
            img: z.string().optional(),
            system: z.record(z.any()).optional(),
          })
        )
        .min(1),
    });

    const { actorIdentifier, itemUpdates } = schema.parse(args);

    this.logger.info('Updating actor embedded items', {
      actorIdentifier,
      count: itemUpdates.length,
    });

    const result = await this.foundryClient.query('foundry-mcp-bridge.updateActorItems', {
      actorIdentifier,
      itemUpdates,
    });

    return result;
  }

  // ── delete-items ────────────────────────────────────────────────────────────

  private async handleDeleteItems(args: any): Promise<any> {
    const schema = z.object({
      actorIdentifier: z.string().min(1),
      itemIds: z.array(z.string().min(1)).min(1),
    });

    const { actorIdentifier, itemIds } = schema.parse(args);

    this.logger.info('Deleting actor embedded items', {
      actorIdentifier,
      count: itemIds.length,
    });

    const result = await this.foundryClient.query('foundry-mcp-bridge.deleteActorItems', {
      actorIdentifier,
      itemIds,
    });

    return result;
  }

  // ── place-existing-actor-token (T36, scene-mgmt-SPEC §5.2) ──────────────────

  /**
   * Drop a token for an existing world actor onto a scene (incl. the PC). Wraps
   * the module's addActorsToScene placement path for a single actor, forwarding
   * an optional target scene and exact coordinates. Ownership inherits from the
   * actor's prototype token (§4) — this handler sets no ownership override, so a
   * player-owned PC yields a player-controllable token and NPCs stay GM-only.
   * Placement is setup, not a PC decision (D2), so the PC is a valid target here.
   */
  async handlePlaceExistingActorToken(args: any): Promise<any> {
    const schema = z.object({
      actor_id: z.string().min(1),
      scene_id: z.string().min(1).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      hidden: z.boolean().optional().default(false),
    });

    const { actor_id, scene_id, x, y, hidden } = schema.parse(args);

    const hasCoords = x !== undefined && y !== undefined;

    this.logger.info('Placing existing actor token', {
      actor_id,
      scene_id: scene_id ?? '(active)',
      placement: hasCoords ? 'coordinates' : 'center',
      hidden,
    });

    const result = await this.foundryClient.query('foundry-mcp-bridge.addActorsToScene', {
      actorIds: [actor_id],
      placement: hasCoords ? 'coordinates' : 'center',
      hidden,
      ...(hasCoords ? { coordinates: [{ x, y }] } : {}),
      ...(scene_id ? { sceneId: scene_id } : {}),
    });

    return result;
  }
}
