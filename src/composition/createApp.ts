import { PracticeController } from '../application/PracticeController.js';
import { FlowMode, FLOW_MODE_ID } from '../application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../application/modes/PracticeModeRegistry.js';
import { WaitMode } from '../application/modes/WaitMode.js';
import type { IScoringStrategy } from '../domain/scoring/IScoringStrategy.js';
import type { IPitchPlayer } from '../application/ports/IPitchPlayer.js';
import type {
  IMidiConnection,
  IMidiDeviceDirectory,
  IMidiSource,
} from '../application/ports/IMidiSource.js';
import type { IScoreRenderer } from '../application/ports/IScoreRenderer.js';
import { ExercisePresetRegistry } from '../domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../domain/generation/presets.js';
import { MusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import {
  AccuracyScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../domain/scoring/strategies.js';
import { WebAudioMetronome, createAudioContextFactory } from '../infrastructure/audio/WebAudioMetronome.js';
import { WebAudioPitchPlayer } from '../infrastructure/audio/WebAudioPitchPlayer.js';
import { CompositeMidiSource } from '../infrastructure/midi/CompositeMidiSource.js';
import {
  ComputerKeyboardMidiSource,
  type KeyboardTarget,
} from '../infrastructure/midi/ComputerKeyboardMidiSource.js';
import { WebMidiAdapter } from '../infrastructure/midi/WebMidiAdapter.js';
import { browserMidiAccessProvider } from '../infrastructure/midi/webmidi-dom.js';
import { OsmdScoreRenderer } from '../infrastructure/rendering/OsmdScoreRenderer.js';
import { SystemClock } from '../infrastructure/time/SystemClock.js';

export interface AppRuntimeOptions {
  readonly scoreContainer: HTMLElement;
  readonly keyboardTarget: KeyboardTarget;
}

/**
 * Everything the UI is allowed to talk to.
 *
 * Deliberately expressed in ports rather than in concrete adapters, so the
 * view can be driven by test doubles exactly as it is driven in the browser.
 */
export interface AppRuntime {
  readonly controller: PracticeController;
  readonly presets: ExercisePresetRegistry;
  readonly modes: PracticeModeRegistry;
  readonly webMidi: IMidiSource & IMidiConnection & IMidiDeviceDirectory;
  readonly computerKeyboard: IMidiSource & IToggleableInput;
  readonly pitchPlayer: IPitchPlayer;
  readonly renderer: IScoreRenderer;
  dispose(): void;
}

/** An input source the user can switch on and off. */
export interface IToggleableInput {
  readonly isEnabled: boolean;
  enable(): void;
  disable(): void;
}

/**
 * Composition root.
 *
 * This is the only place where concrete adapters meet the application. Every
 * other module receives its collaborators through constructor parameters, so
 * swapping OSMD, Web MIDI or Web Audio for something else - or for a test
 * double - happens here and nowhere else.
 */
export function createApp(options: AppRuntimeOptions): AppRuntime {
  const clock = new SystemClock();
  const audioContextFactory = createAudioContextFactory();

  const metronome = new WebAudioMetronome(audioContextFactory);
  const pitchPlayer = new WebAudioPitchPlayer(audioContextFactory);

  const webMidi = new WebMidiAdapter(browserMidiAccessProvider(), clock);
  const computerKeyboard = new ComputerKeyboardMidiSource(options.keyboardTarget, clock);
  const midi = new CompositeMidiSource([webMidi, computerKeyboard]);

  const renderer = new OsmdScoreRenderer(options.scoreContainer);
  const serializer = new MusicXmlSerializer();

  const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
  const modes = new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]);

  const accuracyScoring = new AccuracyScoringStrategy();
  const timingScoring = new TimingWeightedScoringStrategy();
  const scoringFor = (modeId: string): IScoringStrategy =>
    modeId === FLOW_MODE_ID ? timingScoring : accuracyScoring;

  const controller = new PracticeController({
    presets,
    modes,
    serializer,
    renderer,
    cursor: renderer.cursor,
    midi,
    metronome,
    clock,
    scoringFor,
  });

  return {
    controller,
    presets,
    modes,
    webMidi,
    computerKeyboard,
    pitchPlayer,
    renderer,
    dispose(): void {
      controller.dispose();
      computerKeyboard.disable();
      void webMidi.disconnect();
      metronome.stop();
      pitchPlayer.stopAll();
    },
  };
}
