/**
 * T-FRAG — combat-state stability: no combatant recreation on re-enroll.
 *
 * Reopened from T-INT non-blocking finding #5 (2026-07-18,
 * docs/playtests/T-INT-write-layer-verdict.md): during live play combatants were
 * reportedly recreated mid-combat (IDs changed, initiative lost), needing a re-roll.
 *
 * Investigation: exercise FoundryDataAccess.enrollTokensInCombat's existing dedupe
 * (data-access.ts ~L7832, `combat.combatants.find(c => c.tokenId === tokenId)`)
 * across a begin-combat -> re-enroll same tokens cycle, and confirm
 * rollNpcInitiative never deletes/recreates combatants — it only calls native
 * `combat.rollInitiative` / `combat.rollNPC`.
 *
 * Foundry globals (`game`) are stubbed on globalThis so both verbs run unmodified
 * against a fake scene/token/combat object whose `combatants` collection behaves
 * like Foundry's (array-like with `find`, mutated in place by
 * `createEmbeddedDocuments`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeToken(id: string) {
  return { id };
}

function makeFakeCombat() {
  const combatants: any[] = [];
  let nextId = 1;

  return {
    id: 'combat1',
    combatants: {
      find: (fn: any) => combatants.find(fn),
      map: (fn: any) => combatants.map(fn),
      filter: (fn: any) => combatants.filter(fn),
    },
    createEmbeddedDocuments: vi.fn(async (_type: string, data: any[]) => {
      const created = data.map(d => {
        const c = { id: `c${nextId++}`, tokenId: d.tokenId, initiative: null, name: d.tokenId };
        combatants.push(c);
        return c;
      });
      return created;
    }),
    rollInitiative: vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        const c = combatants.find(x => x.id === id);
        if (c) c.initiative = 10;
      }
    }),
    rollNPC: vi.fn(async () => {
      for (const c of combatants) {
        if (c.initiative === null) c.initiative = 10;
      }
    }),
    _combatants: combatants,
  };
}

function installFoundryGlobals(opts: { tokens: Record<string, any>; combat: any }) {
  const scene = {
    id: 'scene1',
    tokens: { get: (id: string) => opts.tokens[id] },
  };

  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM' },
    scenes: { current: scene },
    combat: opts.combat,
    settings: {
      get: (_module: string, key: string) => (key === 'allowWriteOperations' ? true : 100),
    },
  };

  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };

  return { scene };
}

describe('enrollTokensInCombat / rollNpcInitiative — combat-state stability (T-FRAG)', () => {
  afterEach(() => {
    delete (globalThis as any).game;
    delete (globalThis as any).Hooks;
    vi.restoreAllMocks();
  });

  it('re-enrolling an already-enrolled token creates no new combatant and preserves its id', async () => {
    const npc1 = makeToken('npc1');
    const combat = makeFakeCombat();
    installFoundryGlobals({ tokens: { npc1 }, combat });

    const dal = new FoundryDataAccess();

    const first: any = await dal.enrollTokensInCombat({ tokenIds: ['npc1'] });
    expect(first.enrolled).toEqual([{ tokenId: 'npc1', combatantId: 'c1' }]);
    expect(combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(combat._combatants).toHaveLength(1);

    // Re-enroll the same token (simulates begin-combat -> re-enroll cycle).
    const second: any = await dal.enrollTokensInCombat({ tokenIds: ['npc1'] });

    expect(second.enrolled).toEqual([{ tokenId: 'npc1', combatantId: 'c1' }]);
    // Dedupe held: no second createEmbeddedDocuments call, no new combatant.
    expect(combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(combat._combatants).toHaveLength(1);
  });

  it('rolling initiative twice does not recreate combatants or change their ids', async () => {
    const npc1 = makeToken('npc1');
    const npc2 = makeToken('npc2');
    const combat = makeFakeCombat();
    installFoundryGlobals({ tokens: { npc1, npc2 }, combat });

    const dal = new FoundryDataAccess();
    await dal.enrollTokensInCombat({ tokenIds: ['npc1', 'npc2'] });

    const idsBefore = combat._combatants.map((c: any) => c.id);

    const rollResult1: any = await dal.rollNpcInitiative({});
    expect(combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1); // still just the enroll call
    expect(combat._combatants.map((c: any) => c.id)).toEqual(idsBefore);
    expect(rollResult1.initiatives.every((i: any) => i.initiative === 10)).toBe(true);

    // Roll again (e.g. a duplicate call/retry) — must not delete/recreate.
    const rollResult2: any = await dal.rollNpcInitiative({});
    expect(combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(combat._combatants.map((c: any) => c.id)).toEqual(idsBefore);
    expect(rollResult2.initiatives).toEqual(rollResult1.initiatives);
  });

  it('re-enroll after rolling initiative preserves the rolled initiative (no reset)', async () => {
    const npc1 = makeToken('npc1');
    const combat = makeFakeCombat();
    installFoundryGlobals({ tokens: { npc1 }, combat });

    const dal = new FoundryDataAccess();
    await dal.enrollTokensInCombat({ tokenIds: ['npc1'] });
    await dal.rollNpcInitiative({});

    const rolledInitiative = combat._combatants[0].initiative;
    expect(rolledInitiative).toBe(10);

    // Re-enroll the same token again mid-combat.
    const reEnroll: any = await dal.enrollTokensInCombat({ tokenIds: ['npc1'] });

    expect(reEnroll.enrolled).toEqual([{ tokenId: 'npc1', combatantId: 'c1' }]);
    expect(combat._combatants).toHaveLength(1);
    expect(combat._combatants[0].initiative).toBe(rolledInitiative);
  });
});
