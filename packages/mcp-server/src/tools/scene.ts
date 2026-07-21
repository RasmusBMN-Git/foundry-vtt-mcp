import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface SceneToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class SceneTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: SceneToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'SceneTools' });
  }

  /**
   * Tool definitions for scene operations
   */
  getToolDefinitions() {
    return [
      {
        name: 'get-current-scene',
        description:
          'Get information about the currently active scene, including tokens and layout',
        inputSchema: {
          type: 'object',
          properties: {
            includeTokens: {
              type: 'boolean',
              description: 'Whether to include detailed token information (default: true)',
              default: true,
            },
            includeHidden: {
              type: 'boolean',
              description: 'Whether to include hidden tokens and elements (default: false)',
              default: false,
            },
          },
        },
      },
      {
        name: 'get-world-info',
        description: 'Get basic information about the Foundry world and system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'update-scene',
        description:
          "Update scene-document fields on a scene without opening Scene Configuration by hand — the umbrella scene editor. Pass a fields object with one or more whitelisted top-level keys: name, background, foreground, width, height, padding, grid, tokenVision, globalLight, environment, initial, backgroundColor. Any key outside that whitelist is rejected (nothing is silently written). background wires an image, e.g. { background: { src: 'worlds/…/map.webp' } }; grid takes { size, type, distance, units }; tokenVision/globalLight toggle lighting. Give scene_id to target a specific (e.g. freshly generated) scene, otherwise the active scene is updated. This is scene-doc bookkeeping only — no token/actor is targeted. Returns { success, sceneId, updatedFields }. For focused edits prefer set-scene-background / configure-scene-vision-lighting / set-scene-grid-dimensions, which build the right fields for you.",
        inputSchema: {
          type: 'object',
          properties: {
            scene_id: {
              type: 'string',
              description: 'Optional. ID of the target scene. Defaults to the active scene.',
            },
            fields: {
              type: 'object',
              description:
                'Scene fields to update. Whitelisted top-level keys only: name, background, foreground, width, height, padding, grid, tokenVision, globalLight, environment, initial, backgroundColor.',
              additionalProperties: true,
            },
          },
          required: ['fields'],
        },
      },
      {
        name: 'set-scene-background',
        description:
          "Set a scene's background image without opening Scene Configuration by hand. Give an image path (src, e.g. 'worlds/my-world/maps/dungeon.webp' or a generated-map path) and the scene's hasBackground flag flips true so the map renders instead of grey. Optionally give scene_id to target a specific (e.g. freshly generated) scene; otherwise the active scene is used. Focused front-end over update-scene — builds { background: { src } } for you. No token/actor is targeted. Returns { success, sceneId, updatedFields }.",
        inputSchema: {
          type: 'object',
          properties: {
            src: {
              type: 'string',
              description:
                "Image path to wire as the scene background (e.g. 'worlds/<world>/maps/<file>.webp').",
            },
            scene_id: {
              type: 'string',
              description: 'Optional. ID of the target scene. Defaults to the active scene.',
            },
          },
          required: ['src'],
        },
      },
    ];
  }

  async handleGetCurrentScene(args: any): Promise<any> {
    const schema = z.object({
      includeTokens: z.boolean().default(true),
      includeHidden: z.boolean().default(false),
    });

    const { includeTokens, includeHidden } = schema.parse(args);

    this.logger.info('Getting current scene information', { includeTokens, includeHidden });

    try {
      const sceneData = await this.foundryClient.query('foundry-mcp-bridge.getActiveScene');

      this.logger.debug('Successfully retrieved scene data', {
        sceneId: sceneData.id,
        sceneName: sceneData.name,
        tokenCount: sceneData.tokens?.length || 0,
      });

      return this.formatSceneResponse(sceneData, includeTokens, includeHidden);
    } catch (error) {
      this.logger.error('Failed to get current scene', error);
      throw new Error(
        `Failed to get current scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetWorldInfo(_args: any): Promise<any> {
    this.logger.info('Getting world information');

    try {
      const worldData = await this.foundryClient.query('foundry-mcp-bridge.getWorldInfo');

      this.logger.debug('Successfully retrieved world data', {
        worldId: worldData.id,
        system: worldData.system,
      });

      return this.formatWorldResponse(worldData);
    } catch (error) {
      this.logger.error('Failed to get world information', error);
      throw new Error(
        `Failed to get world information: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * T36 (scene-mgmt-SPEC §3/§5.6) — update-scene. Forwards a whitelisted fields
   * object to the module's GM-scoped updateScene query. Shared seam that the
   * field setters (background / vision-lighting / grid-dimensions) also front. No
   * token/actor target, so no gate. The whitelist is enforced Foundry-side; a
   * rejected field surfaces as a thrown error, never a silent success.
   */
  async handleUpdateScene(args: any): Promise<any> {
    const schema = z.object({
      scene_id: z.string().min(1).optional(),
      fields: z.record(z.any()),
    });

    const { scene_id, fields } = schema.parse(args);

    this.logger.info('Updating scene fields', {
      scene_id: scene_id ?? '(active)',
      fields: Object.keys(fields ?? {}),
    });

    return await this.foundryClient.query('foundry-mcp-bridge.updateScene', {
      fields,
      ...(scene_id ? { sceneId: scene_id } : {}),
    });
  }

  /**
   * T36 (scene-mgmt-SPEC §5.3) — set-scene-background. Slice-builder front-end
   * over the shared updateScene seam: constructs the narrow { background: { src } }
   * fields object and forwards it to the same GM-scoped updateScene query. Adds no
   * data-access method (the whitelist + scene.update() live Foundry-side). Wiring
   * src flips the read-side hasBackground flag true so the map renders. No
   * token/actor target, so no gate.
   */
  async handleSetSceneBackground(args: any): Promise<any> {
    const schema = z.object({
      src: z.string().min(1),
      scene_id: z.string().min(1).optional(),
    });

    const { src, scene_id } = schema.parse(args);

    this.logger.info('Setting scene background', {
      scene_id: scene_id ?? '(active)',
      src,
    });

    return await this.foundryClient.query('foundry-mcp-bridge.updateScene', {
      fields: { background: { src } },
      ...(scene_id ? { sceneId: scene_id } : {}),
    });
  }

  private formatSceneResponse(sceneData: any, includeTokens: boolean, includeHidden: boolean): any {
    const response: any = {
      id: sceneData.id,
      name: sceneData.name,
      active: sceneData.active,
      dimensions: {
        width: sceneData.width,
        height: sceneData.height,
        padding: sceneData.padding,
      },
      hasBackground: !!sceneData.background,
      navigation: sceneData.navigation,
      // T32 (SPEC §5.5) — grid size/distance so the DM can reason in grid
      // units when planning NPC moves (moves are snapped server-side anyway).
      grid: {
        size: sceneData.grid?.size,
        distance: sceneData.grid?.distance,
      },
      elements: {
        walls: sceneData.walls || 0,
        lights: sceneData.lights || 0,
        sounds: sceneData.sounds || 0,
        notes: sceneData.notes?.length || 0,
      },
    };

    if (includeTokens && sceneData.tokens) {
      response.tokens = this.formatTokens(sceneData.tokens, includeHidden);
      response.tokenSummary = this.createTokenSummary(sceneData.tokens, includeHidden);
    }

    if (sceneData.notes && sceneData.notes.length > 0) {
      response.notes = sceneData.notes.map((note: any) => ({
        id: note.id,
        text: this.truncateText(note.text, 100),
        position: { x: note.x, y: note.y },
      }));
    }

    return response;
  }

  private formatTokens(tokens: any[], includeHidden: boolean): any[] {
    return tokens
      .filter(token => includeHidden || !token.hidden)
      .map(token => ({
        id: token.id,
        name: token.name,
        position: {
          x: token.x,
          y: token.y,
        },
        size: {
          width: token.width,
          height: token.height,
        },
        actorId: token.actorId,
        disposition: this.getDispositionName(token.disposition),
        hidden: token.hidden,
        hasImage: !!token.img,
      }));
  }

  private createTokenSummary(tokens: any[], includeHidden: boolean): any {
    const visibleTokens = includeHidden ? tokens : tokens.filter(t => !t.hidden);

    const summary = {
      total: visibleTokens.length,
      byDisposition: {
        friendly: 0,
        neutral: 0,
        hostile: 0,
        unknown: 0,
      },
      hasActors: 0,
      withoutActors: 0,
    };

    visibleTokens.forEach(token => {
      // Count by disposition
      const disposition = this.getDispositionName(token.disposition);
      if (disposition in summary.byDisposition) {
        summary.byDisposition[disposition as keyof typeof summary.byDisposition]++;
      } else {
        summary.byDisposition.unknown++;
      }

      // Count actor association
      if (token.actorId) {
        summary.hasActors++;
      } else {
        summary.withoutActors++;
      }
    });

    return summary;
  }

  private formatWorldResponse(worldData: any): any {
    return {
      id: worldData.id,
      title: worldData.title,
      system: {
        id: worldData.system,
        version: worldData.systemVersion,
      },
      foundry: {
        version: worldData.foundryVersion,
      },
      users: {
        total: worldData.users?.length || 0,
        active: worldData.users?.filter((u: any) => u.active).length || 0,
        gms: worldData.users?.filter((u: any) => u.isGM).length || 0,
        players: worldData.users?.filter((u: any) => !u.isGM).length || 0,
      },
      activeUsers:
        worldData.users
          ?.filter((u: any) => u.active)
          .map((u: any) => ({
            id: u.id,
            name: u.name,
            isGM: u.isGM,
          })) || [],
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

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}
