/**
 * Unit tests for FoundryDataAccess.getRecentChatMessages (T-CHATREAD).
 *
 * The field paths asserted here were pinned from LIVE dnd5e 5.3.3 chat cards
 * (T-CHATREAD STEP 1, recorded in tasks/T-CHATREAD-bridge-chat-hook.md):
 *  - native attack/damage/save/healing cards classify off `flags.dnd5e.roll.type`;
 *  - roll totals come from `message.rolls[].total`, damage type from
 *    `rolls[].options.type` — never rendered HTML;
 *  - targets come from `flags.dnd5e.targets[]` (uuid → token/actor id);
 *  - the `request-player-rolls` button emits a FLAG-LESS plain Roll whose only
 *    classifier is `message.flavor` (e.g. "WIS Saving Throw (Public)");
 *  - anything else (healing, plain GM text, unparseable) → 'other', never a crash.
 *
 * This is a pure read: no write path, no permission logic is exercised (the GM
 * gate lives in queries.ts). The method only reads a mocked `game.messages`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

// Minimal stand-ins so `rolls[].constructor.name` mirrors the live classes.
class D20Roll {
  constructor(
    public total: number,
    public formula: string,
    public options: Record<string, unknown> = {}
  ) {}
}
class DamageRoll {
  constructor(
    public total: number,
    public formula: string,
    public options: Record<string, unknown> = {}
  ) {}
}
class Roll {
  constructor(
    public total: number,
    public formula: string,
    public options: Record<string, unknown> = {}
  ) {}
}

const SCENE = '1SMzMxDwA9eMxDOR';
const targetSpecter = {
  name: 'Specter',
  img: 'systems/dnd5e/tokens/undead/Specter.webp',
  uuid: `Scene.${SCENE}.Token.Blf4hwFVTVAQvrvh.Actor.KizVXE7v9uVTTbzC`,
  ac: 12,
};

// --- mock cards, one per live shape ------------------------------------------

const attackCard = {
  id: 'attack1',
  timestamp: 1000,
  flavor: 'Scimitar - Attack Roll',
  speaker: { scene: SCENE, actor: 'mtTNQQm7swjAlSm3', token: 'gMSNqNAqY9RM8rFW', alias: 'Goblin' },
  flags: {
    dnd5e: {
      item: {
        type: 'weapon',
        id: 'S6UTTLu0bEB32HNG',
        uuid: `Scene.${SCENE}.Item.S6UTTLu0bEB32HNG`,
      },
      targets: [targetSpecter],
      messageType: 'roll',
      roll: { type: 'attack', attackMode: 'oneHanded' },
    },
  },
  rolls: [new D20Roll(24, '1d20 + 2 + 2')],
};

const damageCard = {
  id: 'damage1',
  timestamp: 2000,
  flavor: 'Scimitar - Damage Roll',
  speaker: { scene: SCENE, actor: 'mtTNQQm7swjAlSm3', token: 'gMSNqNAqY9RM8rFW', alias: 'Goblin' },
  flags: {
    dnd5e: {
      item: {
        type: 'weapon',
        id: 'S6UTTLu0bEB32HNG',
        uuid: `Scene.${SCENE}.Item.S6UTTLu0bEB32HNG`,
      },
      targets: [targetSpecter],
      messageType: 'roll',
      roll: { type: 'damage' },
    },
  },
  rolls: [new DamageRoll(8, '2d6 + 2', { type: 'slashing' })],
};

const saveNativeCard = {
  id: 'saveN1',
  timestamp: 3000,
  flavor: 'Constitution Saving Throw',
  speaker: { scene: SCENE, actor: 'aaa', token: 'bbb', alias: 'Bandit Captain' },
  flags: { dnd5e: { messageType: 'roll', roll: { ability: 'con', type: 'save' } } },
  rolls: [new D20Roll(11, '1d20 + 2')],
};

// The bridge's request-player-rolls button — plain Roll, NO dnd5e flags.
const saveBridgeCard = {
  id: 'saveB1',
  timestamp: 4000,
  flavor: 'WIS Saving Throw (Public)',
  speaker: { scene: SCENE, actor: '7miF0ARG1acQQiZq', token: 'IssMaICjUbiQg4SO', alias: 'TestPC' },
  flags: {},
  rolls: [new Roll(13, '1d20 + 6')],
};

const healingCard = {
  id: 'heal1',
  timestamp: 5000,
  flavor: 'Healing Word - Healing Roll',
  speaker: { scene: SCENE, actor: 'ccc', token: 'ddd', alias: 'Cleric' },
  flags: { dnd5e: { messageType: 'roll', roll: { type: 'healing' } } },
  rolls: [new DamageRoll(8, '2d4 + 4', { type: 'healing' })],
};

// Native death save — flags.dnd5e.roll.type === 'death'.
const deathSaveCard = {
  id: 'death1',
  timestamp: 5500,
  flavor: 'Death Saving Throw',
  speaker: { scene: SCENE, actor: 'eee', token: 'fff', alias: 'TestPC' },
  flags: { dnd5e: { messageType: 'roll', roll: { type: 'death' } } },
  rolls: [new D20Roll(14, '1d20')],
};

// FLAG-LESS healing roll — classifier is the flavor field only.
const healingFlavorCard = {
  id: 'healF1',
  timestamp: 5700,
  flavor: 'Lay on Hands - Healing',
  speaker: { scene: SCENE, actor: 'ggg', token: 'hhh', alias: 'Paladin' },
  flags: {},
  rolls: [new Roll(10, '10')],
};

// FLAG-LESS death save — flavor contains both "death sav" and "saving throw".
const deathFlavorCard = {
  id: 'deathF1',
  timestamp: 5800,
  flavor: 'Death Saving Throw (Public)',
  speaker: { scene: SCENE, actor: 'iii', token: 'jjj', alias: 'TestPC' },
  flags: {},
  rolls: [new Roll(9, '1d20')],
};

const plainTextCard = {
  id: 'text1',
  timestamp: 6000,
  flavor: '',
  speaker: { actor: null, token: null, alias: 'Gamemaster' },
  flags: {},
  rolls: [],
};

const ALL_CARDS = [
  attackCard,
  damageCard,
  saveNativeCard,
  saveBridgeCard,
  healingCard,
  deathSaveCard,
  healingFlavorCard,
  deathFlavorCard,
  plainTextCard,
];

function setMessages(cards: any[]) {
  (globalThis as any).game = {
    ready: true,
    world: { id: 'w1' },
    user: { id: 'u1', name: 'GM', isGM: true },
    messages: { contents: cards, size: cards.length },
  };
}

beforeEach(() => {
  // Constructor registers Foundry Hooks — stub so construction doesn't throw.
  (globalThis as any).Hooks = { on: () => {}, off: () => {}, once: () => {} };
  setMessages(ALL_CARDS);
});

afterEach(() => {
  delete (globalThis as any).game;
  delete (globalThis as any).Hooks;
});

function byId(messages: any[], id: string) {
  return messages.find(m => m.id === id);
}

describe('getRecentChatMessages — classification', () => {
  it('classifies a native attack card off flags.dnd5e.roll.type', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'attack1');
    expect(rec.classification).toBe('attack');
    expect(rec.dnd5eRollType).toBe('attack');
  });

  it('classifies a native damage card and surfaces damage type + total', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'damage1');
    expect(rec.classification).toBe('damage');
    expect(rec.rollTotal).toBe(8);
    expect(rec.rolls[0].damageType).toBe('slashing');
    expect(rec.rolls[0].class).toBe('DamageRoll');
  });

  it('classifies a native save card and exposes the save ability', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'saveN1');
    expect(rec.classification).toBe('save');
    expect(rec.ability).toBe('con');
    expect(rec.rollTotal).toBe(11);
  });

  it('classifies a FLAG-LESS request-player-rolls save via flavor fallback', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'saveB1');
    expect(rec.classification).toBe('save');
    expect(rec.dnd5eRollType).toBeNull();
    expect(rec.rollTotal).toBe(13);
  });

  it('classifies a native healing card as heal and preserves the raw roll type', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'heal1');
    expect(rec.classification).toBe('heal');
    expect(rec.dnd5eRollType).toBe('healing');
  });

  it('classifies a native death save off flags.dnd5e.roll.type', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'death1');
    expect(rec.classification).toBe('death');
    expect(rec.dnd5eRollType).toBe('death');
  });

  it('classifies a FLAG-LESS healing roll via flavor fallback', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'healF1');
    expect(rec.classification).toBe('heal');
    expect(rec.dnd5eRollType).toBeNull();
  });

  it('classifies a FLAG-LESS death save as death, not save, via flavor fallback', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'deathF1');
    expect(rec.classification).toBe('death');
    expect(rec.dnd5eRollType).toBeNull();
  });

  it('classifies a non-roll GM text message as other without crashing', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'text1');
    expect(rec.classification).toBe('other');
    expect(rec.rollTotal).toBeNull();
    expect(rec.rolls).toEqual([]);
  });
});

describe('getRecentChatMessages — target + item parsing', () => {
  it('parses target token/actor ids from the dnd5e target uuid', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'attack1');
    expect(rec.targets).toHaveLength(1);
    expect(rec.targets[0]).toMatchObject({
      name: 'Specter',
      tokenId: 'Blf4hwFVTVAQvrvh',
      actorId: 'KizVXE7v9uVTTbzC',
      ac: 12,
    });
  });

  it('surfaces the item id/uuid and speaker', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    const rec = byId(messages, 'attack1');
    expect(rec.item).toMatchObject({ id: 'S6UTTLu0bEB32HNG', type: 'weapon' });
    expect(rec.speaker).toMatchObject({ token: 'gMSNqNAqY9RM8rFW', alias: 'Goblin' });
  });

  it('returns empty targets (not a crash) when the card carries none', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    expect(byId(messages, 'saveB1').targets).toEqual([]);
    expect(byId(messages, 'text1').item).toBeNull();
  });
});

describe('getRecentChatMessages — limit + ordering', () => {
  it('defaults to the last 10, oldest-to-newest', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    expect(messages).toHaveLength(9);
    expect(messages[0].id).toBe('attack1'); // oldest
    expect(messages[messages.length - 1].id).toBe('text1'); // most recent
  });

  it('honors an explicit limit, returning the most recent N', async () => {
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages({ limit: 2 });
    expect(messages.map(m => m.id)).toEqual(['deathF1', 'text1']);
  });

  it('clamps limit to the 1..30 range', async () => {
    const da = new FoundryDataAccess();
    expect((await da.getRecentChatMessages({ limit: 0 })).messages).toHaveLength(1);
    expect((await da.getRecentChatMessages({ limit: 999 })).messages).toHaveLength(9);
  });

  it('returns an empty list (not a crash) when the chat log is empty', async () => {
    setMessages([]);
    const da = new FoundryDataAccess();
    const { messages } = await da.getRecentChatMessages();
    expect(messages).toEqual([]);
  });
});
