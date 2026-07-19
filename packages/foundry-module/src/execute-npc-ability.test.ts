/**
 * Unit tests for FoundryDataAccess.executeNpcAbility (T33 + T33-FIX).
 *
 * Contract: /bridge/npc-write-layer-SPEC.md §5.2/§5.3 + the T33-FIX task
 * (attack fast-forward + auto-damage on hit through the T31 gate).
 *
 * The real dnd5e Activity firing lives in Foundry (V1 B2 confirmed a live
 * goblin Scimitar activity resolving with no dialog); what this layer OWNS and
 * is unit-testable here without a live world:
 *  - an attack fires `rollAttack({}, {configure:false}, {create:true})` — the
 *    d20 dialog is fast-forwarded, `.use()` is NOT used for attacks.
 *  - on a hit (attack total ≥ target AC; nat 20 auto-hit+crit, nat 1 miss) it
 *    rolls damage and applies it through the gated `applyDamageToToken` path —
 *    NEVER a raw hp write. A miss applies nothing.
 *  - a PC target routes damage through the target-check gate: needs_approval
 *    when not trusted, auto under trusted mode.
 *  - a save-forcing activity hands a PC's save to the player (D2), never rolls it.
 *
 * The gate (`checkTarget`) runs for real here, driven by a mocked `canvas`
 * resolver; `applyDamageToToken` / `requestPlayerRolls` are spied so this test
 * isolates executeNpcAbility's routing (their own behaviour is covered by T31
 * and the request-player-rolls tests).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeAttackActivity(
  overrides: Partial<{
    attackTotal: number;
    isCritical: boolean;
    isFumble: boolean;
    damageTotal: number;
    damageType: string;
  }> = {}
) {
  const {
    attackTotal = 18,
    isCritical = false,
    isFumble = false,
    damageTotal = 7,
    damageType = 'slashing',
  } = overrides;
  const rollAttack = vi.fn(async () => [{ total: attackTotal, isCritical, isFumble }]);
  const rollDamage = vi.fn(async () => [{ total: damageTotal, options: { type: damageType } }]);
  return { rollAttack, rollDamage };
}

function makeSaveActivity(ability = 'wis') {
  return { save: { ability }, use: vi.fn(async () => ({ id: 'msg1' })) };
}

function attackItem(activity: any, name = 'Scimitar') {
  return {
    id: 'itemA',
    name,
    system: { activities: { getByType: (t: string) => (t === 'attack' ? [activity] : []) } },
  };
}

function saveItem(activity: any, name = 'Hold Person') {
  return {
    id: 'itemS',
    name,
    system: { activities: { getByType: (t: string) => (t === 'save' ? [activity] : []) } },
  };
}

function npcToken(id: string, name: string, opts: { ac?: number; item?: any } = {}) {
  return {
    id,
    name,
    actor: {
      name,
      hasPlayerOwner: false,
      system: { attributes: { ac: { value: opts.ac ?? 12 }, hp: { value: 20 } } },
      items: opts.item ? [opts.item] : [],
      applyDamage: vi.fn(),
    },
  };
}

function pcToken(id: string, name: string, opts: { ac?: number; item?: any } = {}) {
  return {
    id,
    name,
    actor: {
      name,
      hasPlayerOwner: true,
      system: { attributes: { ac: { value: opts.ac ?? 15 }, hp: { value: 30 } } },
      items: opts.item ? [opts.item] : [],
      applyDamage: vi.fn(),
    },
  };
}

function installFoundry(tokens: Record<string, any>) {
  const scene = { id: 's1', tokens: { get: (id: string) => tokens[id] ?? null } };
  // FoundryDataAccess' constructor builds a PersistentCreatureIndex that
  // registers Foundry Hooks — stub them so construction doesn't throw.
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn() };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'w1' },
    user: { id: 'u1', name: 'GM' },
    scenes: { current: scene },
  };
  (globalThis as any).canvas = {
    tokens: {
      get: (id: string) => tokens[id] ?? null,
      setTargets: vi.fn(),
    },
  };
  return scene;
}

function newDataAccess() {
  const da = new FoundryDataAccess();
  const applySpy = vi
    .spyOn(da, 'applyDamageToToken')
    .mockResolvedValue({ hpBefore: 20, hpAfter: 13, success: true } as any);
  const saveReqSpy = vi
    .spyOn(da, 'requestPlayerRolls')
    .mockResolvedValue({ success: true, message: 'requested' } as any);
  return { da, applySpy, saveReqSpy };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).game;
  delete (globalThis as any).canvas;
  delete (globalThis as any).Hooks;
});

describe('executeNpcAbility — attack path fast-forward (T33-FIX)', () => {
  it('fires rollAttack with the dialog config configure:false (no .use)', async () => {
    const activity = makeAttackActivity({ attackTotal: 18 });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity) }),
      npc2: npcToken('npc2', 'Orc', { ac: 12 }),
    });
    const { da } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(activity.rollAttack).toHaveBeenCalledWith({}, { configure: false }, { create: true });
    expect(res.activityType).toBe('attack');
    expect(res.success).toBe(true);
  });

  it('on a hit rolls damage and applies it through the gated apply path (never a raw HP write)', async () => {
    const activity = makeAttackActivity({
      attackTotal: 18,
      damageTotal: 7,
      damageType: 'slashing',
    });
    const orc = npcToken('npc2', 'Orc', { ac: 12 });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity) }),
      npc2: orc,
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(activity.rollDamage).toHaveBeenCalledWith(
      { critical: false },
      { configure: false },
      { create: true }
    );
    // Gated path, not a raw token.actor.applyDamage from inside this method.
    expect(applySpy).toHaveBeenCalledWith({
      tokenId: 'npc2',
      damage: [{ value: 7, type: 'slashing' }],
    });
    expect(res.results[0].hit).toBe(true);
    expect(res.results[0].decision).toBe('auto');
    expect(res.results[0].damage).toBe(7);
  });

  it('a miss applies no damage and does not roll damage', async () => {
    const activity = makeAttackActivity({ attackTotal: 8 });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity) }),
      npc2: npcToken('npc2', 'Orc', { ac: 15 }),
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(activity.rollDamage).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(res.results[0].hit).toBe(false);
  });

  it('a natural 20 always hits and crits (damage rolled with critical:true) even below AC', async () => {
    const activity = makeAttackActivity({ attackTotal: 5, isCritical: true });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity) }),
      npc2: npcToken('npc2', 'Ancient Dragon', { ac: 99 }),
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(res.results[0].hit).toBe(true);
    expect(res.results[0].crit).toBe(true);
    expect(activity.rollDamage).toHaveBeenCalledWith(
      { critical: true },
      { configure: false },
      { create: true }
    );
    expect(applySpy).toHaveBeenCalledOnce();
  });
});

describe('executeNpcAbility — PC target damage routes through the gate', () => {
  it('returns needs_approval and applies nothing when not trusted (D4)', async () => {
    const activity = makeAttackActivity({
      attackTotal: 18,
      damageTotal: 6,
      damageType: 'slashing',
    });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity) }),
      pc1: pcToken('pc1', 'TestPC', { ac: 15 }),
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['pc1'],
      // trustedMode omitted → false
    });

    expect(res.results[0].hit).toBe(true);
    expect(res.results[0].decision).toBe('needs_approval');
    expect(res.results[0].approval.status).toBe('needs_approval');
    expect(res.results[0].approval.target.is_pc).toBe(true);
    expect(applySpy).not.toHaveBeenCalled(); // no write until approved
  });

  it('auto-applies to a PC target under trusted mode (DM owns the consequence)', async () => {
    const activity = makeAttackActivity({
      attackTotal: 18,
      damageTotal: 6,
      damageType: 'slashing',
    });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity) }),
      pc1: pcToken('pc1', 'TestPC', { ac: 15 }),
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['pc1'],
      trustedMode: true,
    });

    expect(res.results[0].decision).toBe('auto');
    expect(applySpy).toHaveBeenCalledWith({
      tokenId: 'pc1',
      damage: [{ value: 6, type: 'slashing' }],
    });
  });
});

describe('executeNpcAbility — save activity (D2, unchanged)', () => {
  it('hands a PC save to the player and never rolls it, then posts the card', async () => {
    const activity = makeSaveActivity('wis');
    installFoundry({
      npc1: npcToken('npc1', 'Cultist', { item: saveItem(activity) }),
      pc1: pcToken('pc1', 'TestPC'),
    });
    const { da, applySpy, saveReqSpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Hold Person',
      targetTokenIds: ['pc1'],
    });

    expect(saveReqSpy).toHaveBeenCalledOnce();
    expect(saveReqSpy.mock.calls[0][0]).toMatchObject({ rollType: 'save', rollTarget: 'wis' });
    expect(res.activityType).toBe('save');
    expect(res.pcSaveRequested).toEqual({ targetName: 'TestPC', ability: 'wis' });
    expect(activity.use).toHaveBeenCalledWith({}, { configure: false }, { create: true });
    expect(applySpy).not.toHaveBeenCalled(); // saves never route to auto-damage
  });
});

describe('executeNpcAbility — no fireable activity', () => {
  it('throws when the item has neither an attack nor a save activity', async () => {
    const item = {
      id: 'itemX',
      name: 'Trinket',
      system: { activities: { getByType: () => [] } },
    };
    installFoundry({ npc1: npcToken('npc1', 'Goblin', { item }) });
    const { da } = newDataAccess();

    await expect(
      da.executeNpcAbility({ tokenId: 'npc1', itemIdentifier: 'Trinket' })
    ).rejects.toThrow(/no attack\/save Activity/i);
  });
});
