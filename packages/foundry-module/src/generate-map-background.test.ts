/**
 * Unit tests for resolveGeneratedSceneBackgroundUpdate (T36 verb 7, fix generate-map).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §5.7 — the generated map image must be wired as the
 * scene background at scene-create so a generated scene renders instead of grey
 * (background.src set / hasBackground true). Scope is LOCKED to background only: the helper
 * must never emit lighting/vision fields (tokenVision/globalLight stay a deliberate
 * configure-scene-vision-lighting step, Rasmus 2026-07-21).
 *
 * T36-FIX (OPS 2026-07-21 E1): Foundry 14.364's Scene Levels feature moved the persist
 * target from the deprecated top-level `Scene#background` (writes silently dropped) to
 * `scene._source.levels[0].background.src`. The helper now reads/repairs the levels
 * path — confirmed live: deep-clone `_source.levels`, set `[0].background.src`,
 * `scene.update({ levels })` renders immediately.
 *
 * The live scene-create path (confirmed by tracing the query chain: backend.ts builds the
 * payload → `job-completed` broadcast → socket-bridge.handleJobCompleted → Scene.create) is
 * exercised at the T36 live gate; here we unit-test the pure background-repair decision the
 * handler applies to the created scene. No Foundry globals needed — the helper is pure.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveGeneratedMapBackgroundSrc,
  resolveGeneratedSceneBackgroundUpdate,
} from './socket-bridge.js';

const SRC = 'worlds/test-world/ai-generated-maps/map_job1_1721577600000.png';

describe('generate-map — background wiring at scene-create (T36 verb 7, §5.7, T36-FIX)', () => {
  it('wires levels[0].background.src when the created scene level has no background (grey-scene repair)', () => {
    const sceneData = { name: 'Cavern', background: { src: SRC }, img: SRC };
    const createdScene = {
      _source: { levels: [{ _id: 'defaultLevel0000', background: { src: '' } }] },
    };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toEqual({
      levels: [{ _id: 'defaultLevel0000', background: { src: SRC } }],
    });
  });

  it('falls back to the legacy img field when the payload has no background.src', () => {
    const sceneData = { name: 'Cavern', img: SRC };
    const createdScene = { _source: { levels: [{ background: { src: undefined } }] } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toEqual({
      levels: [{ background: { src: SRC } }],
    });
  });

  it('does NOT re-write when the first level already has its background src (no redundant update)', () => {
    const sceneData = { name: 'Cavern', background: { src: SRC } };
    const createdScene = { _source: { levels: [{ background: { src: SRC } }] } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toBeNull();
  });

  it('deep-clones — does not mutate the input levels array or its entries', () => {
    const sceneData = { name: 'Cavern', background: { src: SRC } };
    const originalLevel = { _id: 'defaultLevel0000', background: { src: '' } };
    const levels = [originalLevel];
    const createdScene = { _source: { levels } };

    const update = resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene);

    expect(update).toEqual({ levels: [{ _id: 'defaultLevel0000', background: { src: SRC } }] });
    expect(originalLevel.background.src).toBe(''); // untouched
    expect(update!.levels).not.toBe(levels); // new array
    expect(update!.levels[0]).not.toBe(originalLevel); // new object
  });

  it('preserves levels beyond index 0 unchanged', () => {
    const sceneData = { name: 'Tower', background: { src: SRC } };
    const upperLevel = { _id: 'level2', background: { src: 'worlds/w/upper.webp' } };
    const createdScene = {
      _source: { levels: [{ _id: 'defaultLevel0000', background: { src: '' } }, upperLevel] },
    };

    const update = resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene);

    expect(update!.levels[1]).toBe(upperLevel);
  });

  it('handles a missing levels array without throwing (guards, does not repair)', () => {
    const sceneData = { name: 'Cavern', background: { src: SRC } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, { _source: {} })).toBeNull();
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, {})).toBeNull();
  });

  it('handles an empty levels array without throwing (guards, does not repair)', () => {
    const sceneData = { name: 'Cavern', background: { src: SRC } };
    const createdScene = { _source: { levels: [] } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toBeNull();
  });

  it('returns null (no write) when there is no image to wire', () => {
    expect(resolveGeneratedSceneBackgroundUpdate({ name: 'Blank' }, {})).toBeNull();
    expect(resolveGeneratedSceneBackgroundUpdate(null, null)).toBeNull();
  });

  it('emits ONLY the levels field — never lighting/vision (locked scope)', () => {
    const sceneData = {
      name: 'Cavern',
      background: { src: SRC },
      tokenVision: true,
      globalLight: false,
      darkness: 0,
    };
    const createdScene = { _source: { levels: [{ background: { src: '' } }] } };
    const update = resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene);
    expect(update).not.toBeNull();
    expect(Object.keys(update!)).toEqual(['levels']);
    expect(update).toEqual({ levels: [{ background: { src: SRC } }] });
  });
});

/**
 * T36-FIX-2 (live gate 2026-07-21, NO-GO #2): the levels repair above was correct but never
 * fired — `Scene.create` cleans the create payload IN PLACE, so v14 strips `background.src`
 * and the legacy `img` off `sceneData` before the repair reads them. Live probe:
 * `new Scene(d)` left `d.img === null` and `d.background === { offsetX: 0, offsetY: 0 }`.
 * The desired src must be snapshotted BEFORE the create call, with the job message's
 * `image_path` (never handed to the DataModel) as the fallback.
 */
describe('generate-map — desired background src is resolved before Scene.create (T36-FIX-2)', () => {
  it('prefers the payload background.src', () => {
    expect(resolveGeneratedMapBackgroundSrc({ background: { src: SRC } }, 'other/path.png')).toBe(
      SRC
    );
  });

  it('falls back to the legacy img field when background.src is absent', () => {
    expect(resolveGeneratedMapBackgroundSrc({ img: SRC }, 'other/path.png')).toBe(SRC);
  });

  it('falls back to image_path when Scene.create already cleaned the payload in place (the regression)', () => {
    // Exact post-clean shape observed live in the GM console.
    const cleaned = { background: { offsetX: 0, offsetY: 0 }, img: null } as any;
    expect(resolveGeneratedMapBackgroundSrc(cleaned, SRC)).toBe(SRC);
  });

  it('returns null when there is no image to wire', () => {
    expect(resolveGeneratedMapBackgroundSrc({ name: 'Blank' } as any, undefined)).toBeNull();
    expect(resolveGeneratedMapBackgroundSrc(null, null)).toBeNull();
  });
});
