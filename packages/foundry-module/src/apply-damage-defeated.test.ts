/**
 * Unit tests for FoundryDataAccess.applyDamageToToken's T31-FIX behavior
 * (reopened from T-INT NO-GO 2026-07-18, findings #1 + #3).
 *
 * Contract:
 *  - An NPC dropped to <=0 HP with a combatant in the active combat gets that
 *    combatant flagged defeated + the dead overlay, and the call returns
 *    defeatedFlagged:true.
 *  - A PC dropped to <=0 HP is never flagged (PC at 0 HP is unconscious /
 *    death saves, not defeated) — D2/D4 boundary, not this fix's concern to
 *    change.
 *  - An NPC with no combatant in the active combat (or no active combat) is a
 *    no-op on the flagging path — applyDamage still runs, defeatedFlagged
 *    stays false.
 *  - Healing goes through a `type:"healing"` damage entry with the default
 *    multiplier; a negative multiplier is rejected outright (finding #3).
 *
 * Foundry globals (`game`, `CONFIG`, `Hooks`) are stubbed on globalThis so
 * `applyDamageToToken` runs unmodified against fake scene/token/actor/combat
 * objects.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeActor(
  overrides: Partial<{
    type: string;
    hp: number;
    hasToggleStatusEffect: boolean;
  }> = {}
) {
  let hp = overrides.hp ?? 20;
  const actor: any = {
    type: overrides.type ?? 'npc',
    system: {
      attributes: {
        hp: {
          get value() {
            return hp;
          },
        },
      },
    },
    applyDamage: vi.fn(async (damage: Array<{ value: number; type: string }>, opts: any) => {
      const mult = opts?.multiplier ?? 1;
      const total = damage.reduce((sum, d) => sum + d.value, 0) * mult;
      hp = damage[0]?.type === 'healing' ? hp + total : hp - total;
      return actor;
    }),
  };
  if (overrides.hasToggleStatusEffect !== false) {
    actor.toggleStatusEffect = vi.fn(async () => {});
  }
  return actor;
}

function makeToken(id: string, name: string, actor: any) {
  return { id, name, actor };
}

function installFoundryGlobals(opts: {
  sceneToken: any;
  combatant?: { tokenId: string; update: ReturnType<typeof vi.fn> };
  combat?: any;
}) {
  const scene = {
    tokens: { get: (id: string) => (opts.sceneToken?.id === id ? opts.sceneToken : undefined) },
  };

  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world', setFlag: undefined },
    user: { id: 'gm1', name: 'GM' },
    scenes: { current: scene },
    combat:
      opts.combat !== undefined
        ? opts.combat
        : opts.combatant
          ? { combatants: { find: (fn: any) => [opts.combatant].find(fn) ?? undefined } }
          : undefined,
  };

  (globalThis as any).CONFIG = {
    specialStatusEffects: { DEFEATED: 'dead' },
  };

  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };

  return { scene };
}

describe('applyDamageToToken — defeated-flag + heal-arg (T31-FIX)', () => {
  afterEach(() => {
    delete (globalThis as any).game;
    delete (globalThis as any).CONFIG;
    delete (globalThis as any).Hooks;
    vi.restoreAllMocks();
  });

  it('flags an NPC dropped to 0 HP defeated when it has a combatant', async () => {
    const actor = makeActor({ type: 'npc', hp: 10 });
    const token = makeToken('npc1', 'Goblin', actor);
    const combatant = { tokenId: 'npc1', update: vi.fn(async () => {}) };
    installFoundryGlobals({ sceneToken: token, combatant });

    const dal = new FoundryDataAccess();
    const result: any = await dal.applyDamageToToken({
      tokenId: 'npc1',
      damage: [{ value: 10, type: 'slashing' }],
    });

    expect(result.success).toBe(true);
    expect(result.hpAfter).toBe(0);
    expect(result.defeatedFlagged).toBe(true);
    expect(combatant.update).toHaveBeenCalledWith({ defeated: true });
    expect(actor.toggleStatusEffect).toHaveBeenCalledWith('dead', {
      active: true,
      overlay: true,
    });
  });

  it('does not flag a PC dropped to 0 HP', async () => {
    const actor = makeActor({ type: 'character', hp: 10 });
    const token = makeToken('pc1', 'Hero', actor);
    const combatant = { tokenId: 'pc1', update: vi.fn(async () => {}) };
    installFoundryGlobals({ sceneToken: token, combatant });

    const dal = new FoundryDataAccess();
    const result: any = await dal.applyDamageToToken({
      tokenId: 'pc1',
      damage: [{ value: 10, type: 'slashing' }],
    });

    expect(result.success).toBe(true);
    expect(result.hpAfter).toBe(0);
    expect(result.defeatedFlagged).toBe(false);
    expect(combatant.update).not.toHaveBeenCalled();
  });

  it('is a no-op on the flagging path for an NPC with no combatant in the active combat', async () => {
    const actor = makeActor({ type: 'npc', hp: 10 });
    const token = makeToken('npc2', 'Orc', actor);
    // Active combat exists but has no combatant for this token.
    installFoundryGlobals({
      sceneToken: token,
      combat: { combatants: { find: () => undefined } },
    });

    const dal = new FoundryDataAccess();
    const result: any = await dal.applyDamageToToken({
      tokenId: 'npc2',
      damage: [{ value: 10, type: 'slashing' }],
    });

    expect(result.success).toBe(true);
    expect(result.hpAfter).toBe(0);
    expect(result.defeatedFlagged).toBe(false);
  });

  it('is a no-op on the flagging path for an NPC when there is no active combat at all', async () => {
    const actor = makeActor({ type: 'npc', hp: 10 });
    const token = makeToken('npc3', 'Kobold', actor);
    installFoundryGlobals({ sceneToken: token, combat: undefined });

    const dal = new FoundryDataAccess();
    const result: any = await dal.applyDamageToToken({
      tokenId: 'npc3',
      damage: [{ value: 10, type: 'slashing' }],
    });

    expect(result.success).toBe(true);
    expect(result.defeatedFlagged).toBe(false);
  });

  it('heals via a type:"healing" damage entry with the default multiplier', async () => {
    const actor = makeActor({ type: 'npc', hp: 5 });
    const token = makeToken('npc4', 'Wounded Bandit', actor);
    installFoundryGlobals({ sceneToken: token });

    const dal = new FoundryDataAccess();
    const result: any = await dal.applyDamageToToken({
      tokenId: 'npc4',
      damage: [{ value: 8, type: 'healing' }],
    });

    expect(result.success).toBe(true);
    expect(result.hpBefore).toBe(5);
    expect(result.hpAfter).toBe(13);
    expect(actor.applyDamage).toHaveBeenCalledWith([{ value: 8, type: 'healing' }], {
      multiplier: 1,
    });
  });

  it('rejects a negative multiplier outright', async () => {
    const actor = makeActor({ type: 'npc', hp: 10 });
    const token = makeToken('npc5', 'Skeleton', actor);
    installFoundryGlobals({ sceneToken: token });

    const dal = new FoundryDataAccess();

    await expect(
      dal.applyDamageToToken({
        tokenId: 'npc5',
        damage: [{ value: 5, type: 'slashing' }],
        multiplier: -1,
      })
    ).rejects.toThrow(/multiplier must not be negative/);

    expect(actor.applyDamage).not.toHaveBeenCalled();
  });
});
