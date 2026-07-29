/**
 * Unit tests for FoundryDataAccess.removeTokenEffect (T40).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §3 (consequence category) + the T40
 * task file. This method is the complement of toggleTokenCondition: it clears a
 * NAMED ActiveEffect (a spell buff / concentration effect like "Bless") by name
 * (case-insensitive) or exact effect id, with NO CONFIG.statusEffects
 * requirement, via deleteEmbeddedDocuments('ActiveEffect', …).
 *
 * The target-check gate runs in the query handler BEFORE this method (same
 * contract as applyDamageToToken), so it is not exercised here; the gate's own
 * behaviour is covered by target-check.test.ts. What this layer OWNS and is
 * unit-testable without a live world:
 *  - a name match (case-insensitive) removes every matching effect and calls
 *    deleteEmbeddedDocuments with their ids;
 *  - an exact effect-id match removes that effect;
 *  - a no-match name returns notFound:true and NEVER throws / never deletes.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeEffect(id: string, name: string, opts: { label?: string; statuses?: string[] } = {}) {
  return {
    id,
    name,
    label: opts.label,
    statuses: new Set(opts.statuses ?? []),
  };
}

function makeActor(effects: any[]) {
  return {
    name: 'Fenn',
    hasPlayerOwner: false,
    effects: { contents: effects },
    deleteEmbeddedDocuments: vi.fn(async () => []),
  };
}

function installFoundry(token: any) {
  const scene = { id: 's1', tokens: { get: (id: string) => (id === token.id ? token : null) } };
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn() };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'w1' },
    user: { id: 'u1', name: 'GM' },
    scenes: { current: scene },
    // permissionManager.checkWritePermission('modifyScene') reads this toggle.
    settings: { get: () => true },
  };
  return scene;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).game;
  delete (globalThis as any).Hooks;
});

describe('removeTokenEffect — named-effect removal (T40)', () => {
  it('removes a "Bless" effect by name (case-insensitive) and deletes it by id', async () => {
    const bless = makeEffect('eff1', 'Bless');
    const actor = makeActor([bless, makeEffect('eff2', 'Shield of Faith')]);
    const token = { id: 'npc1', name: 'Fenn', actor };
    installFoundry(token);

    const da = new FoundryDataAccess();
    const res = await da.removeTokenEffect({ tokenId: 'npc1', effect: 'bless' });

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['eff1']);
    expect(res.success).toBe(true);
    expect(res.notFound).toBe(false);
    expect(res.removed).toEqual([{ id: 'eff1', name: 'Bless' }]);
  });

  it('removes an effect by exact effect id', async () => {
    const actor = makeActor([makeEffect('eff-xyz', 'Shield of Faith')]);
    const token = { id: 'npc1', name: 'Fenn', actor };
    installFoundry(token);

    const da = new FoundryDataAccess();
    const res = await da.removeTokenEffect({ tokenId: 'npc1', effect: 'eff-xyz' });

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['eff-xyz']);
    expect(res.removed).toEqual([{ id: 'eff-xyz', name: 'Shield of Faith' }]);
  });

  it('removes every effect that matches the name (duplicate concentration buffs)', async () => {
    const actor = makeActor([
      makeEffect('a', 'Bless'),
      makeEffect('b', 'bless'),
      makeEffect('c', 'Bane'),
    ]);
    const token = { id: 'npc1', name: 'Fenn', actor };
    installFoundry(token);

    const da = new FoundryDataAccess();
    const res = await da.removeTokenEffect({ tokenId: 'npc1', effect: 'Bless' });

    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['a', 'b']);
    expect(res.removed.map((r: any) => r.id)).toEqual(['a', 'b']);
  });

  it('returns notFound:true without throwing or deleting for a no-match name', async () => {
    const actor = makeActor([makeEffect('eff1', 'Bless')]);
    const token = { id: 'npc1', name: 'Fenn', actor };
    installFoundry(token);

    const da = new FoundryDataAccess();
    const res = await da.removeTokenEffect({ tokenId: 'npc1', effect: 'Haste' });

    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.notFound).toBe(true);
    expect(res.removed).toEqual([]);
  });

  it("does NOT match on statuses alone (that stays toggle-token-condition's job)", async () => {
    // An effect whose name is "Prone Marker" but which merely carries the
    // "prone" status should NOT be removed when asked to remove "prone".
    const actor = makeActor([makeEffect('eff1', 'Prone Marker', { statuses: ['prone'] })]);
    const token = { id: 'npc1', name: 'Fenn', actor };
    installFoundry(token);

    const da = new FoundryDataAccess();
    const res = await da.removeTokenEffect({ tokenId: 'npc1', effect: 'prone' });

    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(res.notFound).toBe(true);
  });
});
