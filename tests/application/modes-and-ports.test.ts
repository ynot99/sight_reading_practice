import { describe, expect, it, vi } from 'vitest';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { BasePracticeMode, type PracticeStep } from '../../src/application/modes/IPracticeMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { SilentPitchPlayer } from '../../src/application/ports/IPitchPlayer.js';
import { GeneratedExerciseProvider } from '../../src/application/ports/IExerciseProvider.js';
import type { PracticeContext } from '../../src/application/session/PracticeContext.js';
import { DEFAULT_SESSION_OPTIONS } from '../../src/application/session/PracticeContext.js';
import { GrandStaffExerciseGenerator } from '../../src/domain/generation/GrandStaffExerciseGenerator.js';
import { steadyProfile } from '../support/rhythm.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { SilentVoiceGenerator } from '../../src/domain/generation/voices/SilentVoiceGenerator.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { SystemClock } from '../../src/infrastructure/time/SystemClock.js';
import { browserMidiAccessProvider } from '../../src/infrastructure/midi/webmidi-dom.js';
import { assertDefined, assertNever, clamp, elementAt, floorMod } from '../../src/shared/asserts.js';
import { DomainError } from '../../src/shared/errors.js';

class MinimalMode extends BasePracticeMode {
  readonly id = 'mode.minimal';
  readonly label = 'Minimal';
  readonly requiresMetronome = false;
}

describe('BasePracticeMode', () => {
  it('lets a mode implement only what it cares about', () => {
    const mode = new MinimalMode();
    const context = {} as PracticeContext;
    const step = {} as PracticeStep;

    expect(() => {
      mode.onSessionStart(context);
      mode.onStepEntered(context, step);
      mode.onNoteOn(context, {
        type: 'noteon',
        midi: 60,
        velocity: 1,
        timestampMs: 0,
        sourceId: 'test',
      });
      mode.onNoteOff(context, { type: 'noteoff', midi: 60, timestampMs: 0, sourceId: 'test' });
      mode.onBeat(context, {
        index: 0,
        measure: 0,
        beat: 1,
        isBeat: true,
        isDownbeat: true,
        positionTicks: 0,
        scheduledTimeMs: 0,
      });
      mode.onSessionEnd(context);
    }).not.toThrow();
  });

  it('describes the two shipped modes', () => {
    const wait = new WaitMode();
    const flow = new FlowMode();

    expect(wait.requiresMetronome).toBe(false);
    expect(flow.requiresMetronome).toBe(true);
    expect(wait.id).not.toBe(flow.id);
    expect(wait.label.length).toBeGreaterThan(0);
    expect(flow.label.length).toBeGreaterThan(0);
  });
});

describe('PracticeModeRegistry', () => {
  it('registers, lists and resolves modes', () => {
    const registry = new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]);

    expect(registry.list()).toHaveLength(2);
    expect(registry.first().id).toBe(new WaitMode().id);
    expect(registry.get(new FlowMode().id).requiresMetronome).toBe(true);
    expect(registry.has('nope')).toBe(false);
  });

  it('rejects duplicates and unknown lookups', () => {
    const registry = new PracticeModeRegistry().register(new WaitMode());

    expect(() => registry.register(new WaitMode())).toThrow(DomainError);
    expect(() => registry.get('mode.nope')).toThrow(DomainError);
    expect(() => new PracticeModeRegistry().first()).toThrow(DomainError);
  });
});

describe('GeneratedExerciseProvider', () => {
  it('adapts a synchronous generator to the async port', async () => {
    const generator = new GrandStaffExerciseGenerator({
      id: 'gen.silent',
      label: 'Silent',
      staves: [
        { clef: 'treble', voice: new SilentVoiceGenerator() },
        { clef: 'bass', voice: new SilentVoiceGenerator() },
      ],
    });

    const exercise = await new GeneratedExerciseProvider(generator).provide({
      measures: 2,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 60,
      rhythm: steadyProfile(Duration.QUARTER),
      seed: 5,
    });

    expect(exercise.staves[0]?.measures).toHaveLength(2);
  });
});

describe('SilentPitchPlayer', () => {
  it('is a safe null object', () => {
    const player = new SilentPitchPlayer();
    expect(() => {
      player.play();
      player.stop();
      player.stopAll();
    }).not.toThrow();
  });
});

describe('SystemClock', () => {
  it('produces monotonically non-decreasing milliseconds', () => {
    const clock = new SystemClock();
    const first = clock.now();
    const second = clock.now();

    expect(typeof first).toBe('number');
    expect(second).toBeGreaterThanOrEqual(first);
  });
});

describe('browserMidiAccessProvider', () => {
  it('returns null when the host has no Web MIDI', () => {
    expect(browserMidiAccessProvider()).toBeNull();
  });

  it('binds the browser implementation when it exists', async () => {
    const requestMIDIAccess = vi.fn(() => Promise.resolve({ inputs: { values: () => [][Symbol.iterator]() }, onstatechange: null }));
    vi.stubGlobal('navigator', { requestMIDIAccess });

    const provider = browserMidiAccessProvider();
    expect(provider).not.toBeNull();
    await provider?.({ sysex: false });
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });

    vi.unstubAllGlobals();
  });
});

describe('session defaults', () => {
  it('ship sensible values', () => {
    expect(DEFAULT_SESSION_OPTIONS.countInBeats).toBeGreaterThan(0);
    expect(DEFAULT_SESSION_OPTIONS.subdivisionsPerBeat).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SESSION_OPTIONS.matchPolicy.toleranceMs).toBeGreaterThan(0);
  });
});

describe('shared guards', () => {
  it('report out-of-range indices instead of returning undefined', () => {
    expect(elementAt([1, 2, 3], 1)).toBe(2);
    expect(() => elementAt([1], 5)).toThrow(DomainError);
  });

  it('narrow nullable values', () => {
    expect(assertDefined(0, 'zero is fine')).toBe(0);
    expect(() => assertDefined(null, 'boom')).toThrow(DomainError);
    expect(() => assertDefined(undefined, 'boom')).toThrow(DomainError);
  });

  it('implement mathematical modulo and clamping', () => {
    expect(floorMod(-1, 7)).toBe(6);
    expect(floorMod(8, 7)).toBe(1);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(() => clamp(1, 3, 0)).toThrow(DomainError);
  });

  it('turn impossible union members into loud failures', () => {
    expect(() => assertNever('surprise' as never, 'unexpected')).toThrow(DomainError);
  });
});
