/**
 * Unit tests for resolveGeneratedSceneBackgroundUpdate (T36 verb 7, fix generate-map).
 *
 * Contract: /bridge/scene-mgmt-SPEC.md §5.7 — the generated map image must be wired as the
 * scene background at scene-create so a generated scene renders instead of grey
 * (background.src set / hasBackground true). Scope is LOCKED to background only: the helper
 * must never emit lighting/vision fields (tokenVision/globalLight stay a deliberate
 * configure-scene-vision-lighting step, Rasmus 2026-07-21).
 *
 * The live scene-create path (confirmed by tracing the query chain: backend.ts builds the
 * payload → `job-completed` broadcast → socket-bridge.handleJobCompleted → Scene.create) is
 * exercised at the T36 live gate; here we unit-test the pure background-repair decision the
 * handler applies to the created scene. No Foundry globals needed — the helper is pure.
 */

import { describe, it, expect } from 'vitest';
import { resolveGeneratedSceneBackgroundUpdate } from './socket-bridge.js';

const SRC = 'worlds/test-world/ai-generated-maps/map_job1_1721577600000.png';

describe('generate-map — background wiring at scene-create (T36 verb 7, §5.7)', () => {
  it('wires background.src when the created scene has no background (grey-scene repair)', () => {
    // v13 Scene.create dropped the background (the reported grey-scene failure).
    const sceneData = { name: 'Cavern', background: { src: SRC }, img: SRC };
    const createdScene = { _source: { background: { src: '' } } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toEqual({
      background: { src: SRC },
    });
  });

  it('falls back to the legacy img field when the payload has no background.src', () => {
    const sceneData = { name: 'Cavern', img: SRC };
    const createdScene = { background: { src: undefined } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toEqual({
      background: { src: SRC },
    });
  });

  it('does NOT re-write when the scene already has its background src (no redundant update)', () => {
    const sceneData = { name: 'Cavern', background: { src: SRC } };
    const createdScene = { background: { src: SRC } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toBeNull();
  });

  it('reads the persisted src from _source.background.src as well as background.src', () => {
    const sceneData = { name: 'Cavern', background: { src: SRC } };
    const createdScene = { _source: { background: { src: SRC } } };
    expect(resolveGeneratedSceneBackgroundUpdate(sceneData, createdScene)).toBeNull();
  });

  it('returns null (no write) when there is no image to wire', () => {
    expect(resolveGeneratedSceneBackgroundUpdate({ name: 'Blank' }, {})).toBeNull();
    expect(resolveGeneratedSceneBackgroundUpdate(null, null)).toBeNull();
  });

  it('emits ONLY the background field — never lighting/vision (locked scope)', () => {
    const sceneData = {
      name: 'Cavern',
      background: { src: SRC },
      tokenVision: true,
      globalLight: false,
      darkness: 0,
    };
    const update = resolveGeneratedSceneBackgroundUpdate(sceneData, {});
    expect(update).not.toBeNull();
    expect(Object.keys(update!)).toEqual(['background']);
    expect(update).toEqual({ background: { src: SRC } });
  });
});
