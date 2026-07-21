/**
 * Unit tests for ActorManagementTools.handlePlaceExistingActorToken
 * (T36, place-existing-actor-token).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §5.2 + §4. Places an EXISTING world actor's
 * token onto a scene (incl. the PC). What this layer owns and is testable without
 * Foundry:
 *  - forwards a single-actor array to the bridge addActorsToScene query.
 *  - x/y ⇒ placement 'coordinates' + a coordinates array; no x/y ⇒ 'center', no
 *    coordinates field.
 *  - scene_id ⇒ sceneId passthrough; omitted ⇒ no sceneId (active scene fallback).
 *  - hidden passthrough; result passes straight through.
 * Ownership inheritance (§4 — PC → player-owned, NPC → GM-owned) is a Foundry-side
 * property of addActorsToScene spreading the prototype token, exercised at the T36
 * live gate, not here (this handler sets no ownership override — verified by the
 * absence of any ownership field in the forwarded payload).
 */

import { describe, it, expect, vi } from 'vitest';
import { ActorManagementTools } from './actor-management.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ?? (async () => ({ success: true, tokensCreated: 1, tokenIds: ['tk1'] }))
  );
  const logger: any = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  const foundryClient: any = { query };
  const tools = new ActorManagementTools({ foundryClient, logger });
  return { tools, query };
}

describe('place-existing-actor-token — forwards to addActorsToScene', () => {
  it('wraps the actor id in a single-element array', async () => {
    const { tools, query } = makeTools();
    await tools.handlePlaceExistingActorToken({ actor_id: 'pcActor1' });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.addActorsToScene',
      expect.objectContaining({ actorIds: ['pcActor1'] })
    );
  });

  it('with x/y sends placement "coordinates" and a coordinates array', async () => {
    const { tools, query } = makeTools();
    await tools.handlePlaceExistingActorToken({ actor_id: 'a1', x: 300, y: 450 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.addActorsToScene', {
      actorIds: ['a1'],
      placement: 'coordinates',
      hidden: false,
      coordinates: [{ x: 300, y: 450 }],
    });
  });

  it('without x/y sends placement "center" and no coordinates field', async () => {
    const { tools, query } = makeTools();
    await tools.handlePlaceExistingActorToken({ actor_id: 'a1' });
    const payload = query.mock.calls[0][1] as any;
    expect(payload.placement).toBe('center');
    expect(payload.coordinates).toBeUndefined();
  });

  it('forwards scene_id as sceneId; omits it when absent', async () => {
    const { tools, query } = makeTools();
    await tools.handlePlaceExistingActorToken({ actor_id: 'a1', scene_id: 'sceneX' });
    expect((query.mock.calls[0][1] as any).sceneId).toBe('sceneX');

    const { tools: t2, query: q2 } = makeTools();
    await t2.handlePlaceExistingActorToken({ actor_id: 'a1' });
    expect((q2.mock.calls[0][1] as any).sceneId).toBeUndefined();
  });

  it('passes hidden through and defaults it to false', async () => {
    const { tools, query } = makeTools();
    await tools.handlePlaceExistingActorToken({ actor_id: 'a1', hidden: true });
    expect((query.mock.calls[0][1] as any).hidden).toBe(true);

    const { tools: t2, query: q2 } = makeTools();
    await t2.handlePlaceExistingActorToken({ actor_id: 'a1' });
    expect((q2.mock.calls[0][1] as any).hidden).toBe(false);
  });

  it('sets no ownership override in the forwarded payload (§4 inherit-only)', async () => {
    const { tools, query } = makeTools();
    await tools.handlePlaceExistingActorToken({ actor_id: 'pc1', x: 1, y: 2 });
    const payload = query.mock.calls[0][1] as any;
    expect(payload.ownership).toBeUndefined();
    expect(payload.actorLink).toBeUndefined();
  });

  it('passes the placement result straight through', async () => {
    const payload = { success: true, tokensCreated: 1, tokenIds: ['tkA'] };
    const { tools } = makeTools(async () => payload);
    const result = await tools.handlePlaceExistingActorToken({ actor_id: 'a1' });
    expect(result).toEqual(payload);
  });
});

describe('place-existing-actor-token — validation', () => {
  it('rejects a missing actor_id', async () => {
    const { tools } = makeTools();
    await expect(tools.handlePlaceExistingActorToken({})).rejects.toThrow();
  });
});
