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
    // T39: dnd5e stores the melee/ranged flag at attack.type.value. Only a
    // melee attack can auto-crit vs an incapacitated adjacent target.
    attackType: string;
  }> = {}
) {
  const {
    attackTotal = 18,
    isCritical = false,
    isFumble = false,
    damageTotal = 7,
    damageType = 'slashing',
    attackType = 'melee',
  } = overrides;
  const rollAttack = vi.fn(async () => [{ total: attackTotal, isCritical, isFumble }]);
  const rollDamage = vi.fn(async () => [{ total: damageTotal, options: { type: damageType } }]);
  return { rollAttack, rollDamage, attack: { type: { value: attackType } } };
}

function makeSaveActivity(ability = 'wis') {
  return { save: { ability }, use: vi.fn(async () => ({ id: 'msg1' })) };
}

// T37: a save activity that also deals damage (Sacred Flame / Fireball shape).
// `save.ability` is a Set in dnd5e 5.x; the code accepts a Set/array/string, so
// an array is the simplest faithful mock. `save.dc.value` is the effective DC
// (computed at prepareFinalData live). `damage.onSave` ∈ none|half|full.
function makeSaveDamageActivity(
  opts: {
    ability?: string;
    dc?: number;
    onSave?: string;
    damageTotal?: number;
    damageType?: string;
  } = {}
) {
  const {
    ability = 'dex',
    dc = 13,
    onSave = 'none',
    damageTotal = 8,
    damageType = 'radiant',
  } = opts;
  return {
    save: { ability: [ability], dc: { value: dc } },
    damage: { onSave, parts: [{ types: [damageType] }] },
    use: vi.fn(async () => ({ id: 'msgS' })),
    rollDamage: vi.fn(async () => [{ total: damageTotal, options: { type: damageType } }]),
  };
}

// T38: a heal activity (Cure Wounds / Healing Word shape). dnd5e 5.3.3 has NO
// rollHealing — HealActivity rolls healing through `rollDamage`, tagging the roll
// `options.type:"healing"`; the heal path reads `.total` off each returned roll.
function makeHealActivity(opts: { healTotal?: number; healType?: string } = {}) {
  const { healTotal = 9, healType = 'healing' } = opts;
  return {
    rollDamage: vi.fn(async () => [{ total: healTotal, options: { type: healType } }]),
  };
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

function healItem(activity: any, name = 'Cure Wounds') {
  return {
    id: 'itemH',
    name,
    system: { activities: { getByType: (t: string) => (t === 'heal' ? [activity] : []) } },
  };
}

function npcToken(
  id: string,
  name: string,
  // T39: `x`/`y` (grid pixels) + `statuses` let a test place a token adjacent to
  // an incapacitated target for the auto-crit path. Defaults keep every prior
  // test unchanged (position 0,0; no statuses → not incapacitated).
  opts: {
    ac?: number;
    item?: any;
    saveTotal?: number;
    x?: number;
    y?: number;
    statuses?: string[];
  } = {}
) {
  return {
    id,
    name,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: 1,
    height: 1,
    actor: {
      name,
      hasPlayerOwner: false,
      statuses: new Set<string>(opts.statuses ?? []),
      system: { attributes: { ac: { value: opts.ac ?? 12 }, hp: { value: 20 } } },
      items: opts.item ? [opts.item] : [],
      applyDamage: vi.fn(),
      // T37: NPC-vs-NPC save resolution rolls the target's own save.
      rollSavingThrow: vi.fn(async () => [{ total: opts.saveTotal ?? 10 }]),
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
      // D2: a PC's save is ALWAYS rolled by the player. This spy exists only so a
      // test can assert the save path NEVER calls it for a PC target.
      rollSavingThrow: vi.fn(async () => [{ total: 99 }]),
    },
  };
}

const GRID_SIZE = 100;

function installFoundry(tokens: Record<string, any>) {
  const scene = {
    id: 's1',
    grid: { size: GRID_SIZE, distance: 5 },
    tokens: { get: (id: string) => tokens[id] ?? null },
  };
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
    // T39: faithful stand-in for the native canvas.grid.measurePath — Chebyshev
    // cell count between two points (5e default diagonal = 1 space), which is
    // what isWithinFiveFeet reads as `spaces`.
    grid: {
      measurePath: (waypoints: Array<{ x: number; y: number }>) => {
        const [a, b] = waypoints;
        const dxCells = Math.round(Math.abs(a.x - b.x) / GRID_SIZE);
        const dyCells = Math.round(Math.abs(a.y - b.y) / GRID_SIZE);
        const spaces = Math.max(dxCells, dyCells);
        return { spaces, distance: spaces * 5 };
      },
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

    // T-BUG-multiplyNumeric (2026-07-20): the process-config key MUST be
    // `isCritical`, not `critical`. A boolean `critical` crashes dnd5e 5.x's
    // real DamageRoll.build ("Cannot create property 'multiplyNumeric' on
    // boolean …") on every hit; the mocked rollDamage here can't see that, so
    // this assertion is the regression guard that pins the correct key.
    expect(activity.rollDamage).toHaveBeenCalledWith(
      { isCritical: false },
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

  it('a natural 20 always hits and crits (damage rolled with isCritical:true) even below AC', async () => {
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
      { isCritical: true },
      { configure: false },
      { create: true }
    );
    expect(applySpy).toHaveBeenCalledOnce();
  });
});

describe('executeNpcAbility — auto-crit vs an incapacitated adjacent target (T39)', () => {
  it('a MELEE hit within 5 ft on an unconscious target auto-crits (damage rolled isCritical:true)', async () => {
    const activity = makeAttackActivity({ attackTotal: 18, attackType: 'melee' });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity), x: 0, y: 0 }),
      npc2: npcToken('npc2', 'Downed Ally', {
        ac: 12,
        x: 100,
        y: 0,
        statuses: ['unconscious'],
      }),
    });
    const { da } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(res.results[0].hit).toBe(true);
    expect(res.results[0].crit).toBe(true);
    // The auto-crit drives the doubled-dice flag on the real DamageRoll.
    expect(activity.rollDamage).toHaveBeenCalledWith(
      { isCritical: true },
      { configure: false },
      { create: true }
    );
  });

  it('a PARALYZED adjacent target also auto-crits on a melee hit (diagonal cell)', async () => {
    const activity = makeAttackActivity({ attackTotal: 18, attackType: 'melee' });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity), x: 0, y: 0 }),
      // one cell down AND one cell right → diagonal-adjacent = 1 space (5e default).
      npc2: npcToken('npc2', 'Held Foe', {
        ac: 12,
        x: 100,
        y: 100,
        statuses: ['paralyzed'],
      }),
    });
    const { da } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(res.results[0].crit).toBe(true);
    expect(activity.rollDamage).toHaveBeenCalledWith(
      { isCritical: true },
      { configure: false },
      { create: true }
    );
  });

  it('the same unconscious target at 2 squares (10 ft) does NOT force a crit', async () => {
    const activity = makeAttackActivity({ attackTotal: 18, attackType: 'melee' });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity), x: 0, y: 0 }),
      npc2: npcToken('npc2', 'Downed Ally', {
        ac: 12,
        x: 200,
        y: 0,
        statuses: ['unconscious'],
      }),
    });
    const { da } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(res.results[0].hit).toBe(true);
    expect(res.results[0].crit).toBe(false);
    expect(activity.rollDamage).toHaveBeenCalledWith(
      { isCritical: false },
      { configure: false },
      { create: true }
    );
  });

  it('a CONSCIOUS adjacent target does NOT force a crit', async () => {
    const activity = makeAttackActivity({ attackTotal: 18, attackType: 'melee' });
    installFoundry({
      npc1: npcToken('npc1', 'Goblin', { item: attackItem(activity), x: 0, y: 0 }),
      npc2: npcToken('npc2', 'Orc', { ac: 12, x: 100, y: 0 }), // no statuses
    });
    const { da } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Scimitar',
      targetTokenIds: ['npc2'],
    });

    expect(res.results[0].crit).toBe(false);
    expect(activity.rollDamage).toHaveBeenCalledWith(
      { isCritical: false },
      { configure: false },
      { create: true }
    );
  });

  it('a RANGED attack on an adjacent unconscious target does NOT force a crit', async () => {
    const activity = makeAttackActivity({ attackTotal: 18, attackType: 'ranged' });
    installFoundry({
      npc1: npcToken('npc1', 'Archer', { item: attackItem(activity, 'Shortbow'), x: 0, y: 0 }),
      npc2: npcToken('npc2', 'Downed Ally', {
        ac: 12,
        x: 100,
        y: 0,
        statuses: ['unconscious'],
      }),
    });
    const { da } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Shortbow',
      targetTokenIds: ['npc2'],
    });

    expect(res.results[0].crit).toBe(false);
    expect(activity.rollDamage).toHaveBeenCalledWith(
      { isCritical: false },
      { configure: false },
      { create: true }
    );
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

describe('executeNpcAbility — NPC-vs-NPC save-spell auto-resolve (T37)', () => {
  it('a FAILING NPC save applies FULL damage through the gated apply path', async () => {
    const activity = makeSaveDamageActivity({
      ability: 'dex',
      dc: 13,
      onSave: 'none',
      damageTotal: 8,
      damageType: 'radiant',
    });
    const orc = npcToken('npc2', 'Orc', { saveTotal: 10 }); // 10 < 13 → fails
    installFoundry({
      npc1: npcToken('npc1', 'Cultist', { item: saveItem(activity, 'Sacred Flame') }),
      npc2: orc,
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Sacred Flame',
      targetTokenIds: ['npc2'],
    });

    // The target rolls ITS OWN save (DEX), no dialog.
    expect(orc.actor.rollSavingThrow).toHaveBeenCalledWith(
      { ability: 'dex' },
      { configure: false },
      { create: true }
    );
    // Failed save → full damage via the gated path (multiplier 1), never a raw write.
    expect(applySpy).toHaveBeenCalledWith({
      tokenId: 'npc2',
      damage: [{ value: 8, type: 'radiant' }],
      multiplier: 1,
    });
    const r = res.results[0];
    expect(r).toMatchObject({
      tokenId: 'npc2',
      tokenName: 'Orc',
      saveTotal: 10,
      dc: 13,
      saveSucceeded: false,
      damage: 8,
      onSave: 'none',
      multiplier: 1,
      decision: 'auto',
      hpBefore: 20,
      hpAfter: 13,
    });
    expect(r.damageParts).toEqual([{ value: 8, type: 'radiant' }]);
  });

  it('a MADE save vs a cantrip (onSave:none) applies NO damage', async () => {
    const activity = makeSaveDamageActivity({ dc: 13, onSave: 'none', damageTotal: 8 });
    const orc = npcToken('npc2', 'Orc', { saveTotal: 18 }); // 18 >= 13 → succeeds
    installFoundry({
      npc1: npcToken('npc1', 'Cultist', { item: saveItem(activity, 'Sacred Flame') }),
      npc2: orc,
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Sacred Flame',
      targetTokenIds: ['npc2'],
    });

    expect(orc.actor.rollSavingThrow).toHaveBeenCalledOnce();
    expect(applySpy).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({
      saveSucceeded: true,
      multiplier: 0,
      decision: 'save_no_damage',
    });
  });

  it('a MADE save vs onSave:half applies HALF via the applyDamage multiplier (types preserved)', async () => {
    const activity = makeSaveDamageActivity({ dc: 13, onSave: 'half', damageTotal: 10 });
    const orc = npcToken('npc2', 'Orc', { saveTotal: 18 }); // succeeds
    installFoundry({
      npc1: npcToken('npc1', 'Mage', { item: saveItem(activity, 'Fireball') }),
      npc2: orc,
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Fireball',
      targetTokenIds: ['npc2'],
    });

    // Half is the native applyDamage multiplier (0.5) — NOT a pre-floored total —
    // so per-type resistances still apply downstream.
    expect(applySpy).toHaveBeenCalledWith({
      tokenId: 'npc2',
      damage: [{ value: 10, type: 'radiant' }],
      multiplier: 0.5,
    });
    expect(res.results[0]).toMatchObject({
      saveSucceeded: true,
      multiplier: 0.5,
      decision: 'auto',
    });
  });

  it('a PC target still routes to the player handoff — never auto-damaged, never auto-rolled (D2)', async () => {
    const activity = makeSaveDamageActivity({ ability: 'dex', dc: 13, damageTotal: 8 });
    const pc = pcToken('pc1', 'TestPC');
    installFoundry({
      npc1: npcToken('npc1', 'Cultist', { item: saveItem(activity, 'Sacred Flame') }),
      pc1: pc,
    });
    const { da, applySpy, saveReqSpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Sacred Flame',
      targetTokenIds: ['pc1'],
      trustedMode: true, // even under trusted mode a PC save is the player's (D2)
    });

    expect(saveReqSpy).toHaveBeenCalledOnce();
    expect(applySpy).not.toHaveBeenCalled();
    expect(pc.actor.rollSavingThrow).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ tokenId: 'pc1', decision: 'pc_save_requested' });
  });

  it('a mixed NPC+PC target list resolves per-target and rolls spell damage once', async () => {
    const activity = makeSaveDamageActivity({
      ability: 'dex',
      dc: 13,
      onSave: 'half',
      damageTotal: 8,
    });
    const orc = npcToken('npc2', 'Orc', { saveTotal: 5 }); // fails → full
    const pc = pcToken('pc1', 'TestPC');
    installFoundry({
      npc1: npcToken('npc1', 'Mage', { item: saveItem(activity, 'Fireball') }),
      npc2: orc,
      pc1: pc,
    });
    const { da, applySpy, saveReqSpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Fireball',
      targetTokenIds: ['npc2', 'pc1'],
    });

    // Damage rolled once and shared (RAW for area saves).
    expect(activity.rollDamage).toHaveBeenCalledOnce();
    // NPC auto-applied (failed save → full), PC handed off with no auto-damage.
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith({
      tokenId: 'npc2',
      damage: [{ value: 8, type: 'radiant' }],
      multiplier: 1,
    });
    expect(saveReqSpy).toHaveBeenCalledOnce();
    expect(pc.actor.rollSavingThrow).not.toHaveBeenCalled();
    const byId = Object.fromEntries(res.results.map((r: any) => [r.tokenId, r]));
    expect(byId.npc2.decision).toBe('auto');
    expect(byId.pc1.decision).toBe('pc_save_requested');
  });
});

describe('executeNpcAbility — NPC healing cast (T38)', () => {
  it('heals an NPC target through the gated apply path (heal activity → rollDamage)', async () => {
    const activity = makeHealActivity({ healTotal: 9, healType: 'healing' });
    installFoundry({
      npc1: npcToken('npc1', 'Cleric', { item: healItem(activity, 'Cure Wounds') }),
      npc2: npcToken('npc2', 'Wounded Ally'),
    });
    const { da, applySpy } = newDataAccess();
    applySpy.mockResolvedValueOnce({ hpBefore: 3, hpAfter: 12, success: true } as any);

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Cure Wounds',
      targetTokenIds: ['npc2'],
    });

    // dnd5e 5.3.3 heals via rollDamage (NOT rollHealing), dialog fast-forwarded.
    expect(activity.rollDamage).toHaveBeenCalledWith({}, { configure: false }, { create: true });
    // Healing routes through the SAME gated HP-write path as damage, as a
    // type:"healing" entry (applyDamage clamps at max HP) — never a raw write.
    expect(applySpy).toHaveBeenCalledWith({
      tokenId: 'npc2',
      damage: [{ value: 9, type: 'healing' }],
    });
    expect(res.activityType).toBe('heal');
    expect(res.results[0]).toMatchObject({
      tokenId: 'npc2',
      tokenName: 'Wounded Ally',
      healing: 9,
      decision: 'auto',
      hpBefore: 3,
      hpAfter: 12,
    });
    expect(res.results[0].healingParts).toEqual([{ value: 9, type: 'healing' }]);
  });

  it('rolls the healing once and shares it across multiple targets', async () => {
    const activity = makeHealActivity({ healTotal: 7 });
    installFoundry({
      npc1: npcToken('npc1', 'Cleric', { item: healItem(activity, 'Mass Cure Wounds') }),
      npc2: npcToken('npc2', 'Ally A'),
      npc3: npcToken('npc3', 'Ally B'),
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Mass Cure Wounds',
      targetTokenIds: ['npc2', 'npc3'],
    });

    expect(activity.rollDamage).toHaveBeenCalledOnce();
    expect(applySpy).toHaveBeenCalledTimes(2);
    expect(res.results.map((r: any) => r.decision)).toEqual(['auto', 'auto']);
    expect(res.results.every((r: any) => r.healing === 7)).toBe(true);
  });

  it('a PC target needs approval when NOT trusted — no auto-heal write (D4)', async () => {
    const activity = makeHealActivity({ healTotal: 8 });
    installFoundry({
      npc1: npcToken('npc1', 'Cleric', { item: healItem(activity, 'Healing Word') }),
      pc1: pcToken('pc1', 'TestPC'),
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Healing Word',
      targetTokenIds: ['pc1'],
    });

    expect(activity.rollDamage).toHaveBeenCalledOnce(); // card/roll still posts
    expect(applySpy).not.toHaveBeenCalled(); // but no HP write until approved
    expect(res.results[0]).toMatchObject({ tokenId: 'pc1', decision: 'needs_approval' });
    expect(res.results[0].approval).toMatchObject({
      verb: 'npc_heal',
      target: { token_id: 'pc1', is_pc: true },
      proposed: { healing: [{ value: 8, type: 'healing' }] },
    });
  });

  it('a PC target auto-heals under trusted mode (DM owns the consequence)', async () => {
    const activity = makeHealActivity({ healTotal: 8 });
    installFoundry({
      npc1: npcToken('npc1', 'Cleric', { item: healItem(activity, 'Healing Word') }),
      pc1: pcToken('pc1', 'TestPC'),
    });
    const { da, applySpy } = newDataAccess();

    const res = await da.executeNpcAbility({
      tokenId: 'npc1',
      itemIdentifier: 'Healing Word',
      targetTokenIds: ['pc1'],
      trustedMode: true,
    });

    expect(applySpy).toHaveBeenCalledWith({
      tokenId: 'pc1',
      damage: [{ value: 8, type: 'healing' }],
    });
    expect(res.results[0]).toMatchObject({ tokenId: 'pc1', decision: 'auto' });
  });
});

describe('executeNpcAbility — no fireable activity', () => {
  it('throws when the item has no attack, save, nor heal activity', async () => {
    const item = {
      id: 'itemX',
      name: 'Trinket',
      system: { activities: { getByType: () => [] } },
    };
    installFoundry({ npc1: npcToken('npc1', 'Goblin', { item }) });
    const { da } = newDataAccess();

    await expect(
      da.executeNpcAbility({ tokenId: 'npc1', itemIdentifier: 'Trinket' })
    ).rejects.toThrow(/no attack\/save\/heal Activity/i);
  });
});
