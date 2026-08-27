# Piano Sight-Reading Trainer

A client-side sight-reading trainer for piano: it generates fresh grand-staff
exercises, engraves them as real notation, and judges what you play on a MIDI
keyboard in real time. Free, open source, and offline after the first load —
an alternative to the SASR-style drills in Piano Marvel or Sight Reading
Factory.

Two practice modes:

- **Wait mode** — the cursor waits until you actually play the notated chord.
  For learning the page.
- **Flow mode** — the cursor walks with the metronome and grades how close each
  press was to its beat. For building fluency.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script              | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Vite dev server                                   |
| `npm run build`     | Typecheck, then production build into `dist/`     |
| `npm run typecheck` | `tsc --noEmit` over `src` and `tests`             |
| `npm test`          | Vitest, single run                                |
| `npm run test:watch`| Vitest in watch mode                              |
| `npm run coverage`  | Vitest with a V8 coverage report                  |
| `npm run bridge`    | Build, then serve the app + relay MIDI to a tablet |

Web MIDI needs Chrome, Edge or Opera and a secure context (`localhost` counts).
No keyboard to hand? The computer keyboard is wired up as a second MIDI source:
`z s x d c v g b h n j m` is the lower octave, `q 2 w 3 e r 5 t 6 y 7 u` the
upper one.

### Practising on a tablet

iPadOS has no Web MIDI in any browser — every browser there is Safari
underneath — so a tablet can never see a MIDI keyboard by itself. Plug the
keyboard into a computer on the same Wi-Fi and run:

```bash
npm run bridge
```

It prints an address to open on the tablet. The keyboard's notes are relayed
over the local network, and the iPad becomes a screen on the music stand. See
[tools/midi-bridge](tools/midi-bridge/README.md) for the details.

**Fullscreen** hides everything but the score and leaves a pill of controls at
the bottom of the screen - start or pause, stop, next exercise, and the way
out. It asks for real fullscreen where the browser allows it, but the layout
does not depend on that: if fullscreen is refused, the score still takes the
whole page and the pill still gets you out.

## Architecture

Four layers, dependencies pointing strictly inwards. The domain knows nothing
about the application, the application knows nothing about the browser.

```
                    ┌──────────────────────────────────────────┐
   index.html ──►   │  ui/            AppView, dom helpers      │
                    │  composition/   createApp (object graph)  │
                    └──────────────────┬───────────────────────┘
                                       │ depends on
                    ┌──────────────────▼───────────────────────┐
                    │  application/                             │
                    │    PracticeController                     │
                    │    session/  PracticeSession + FSM        │
                    │    modes/    WaitMode | FlowMode          │
                    │    ports/    IMidiSource, IMetronome,     │
                    │              IScoreRenderer, IClock, …    │
                    └───────┬──────────────────────┬───────────┘
                            │ depends on           │ implemented by
                    ┌───────▼──────────┐   ┌───────▼───────────────────┐
                    │  domain/         │   │  infrastructure/          │
                    │   model          │   │   midi/    Web MIDI, kbd  │
                    │   timeline       │   │   audio/   metronome,     │
                    │   matching       │   │            pitch player   │
                    │   notation       │   │   rendering/ OSMD         │
                    │   generation     │   │   time/    SystemClock    │
                    │   scoring        │   │   testing/ mocks & fakes  │
                    └──────────────────┘   └───────────────────────────┘
```

```
src/
├── main.ts                         # entry point: build the graph, hand it to the view
├── styles.css
├── shared/                         # tiny, dependency-free utilities
│   ├── EventEmitter.ts             #   TypedEventEmitter, IEventSource
│   ├── StateMachine.ts             #   declarative transition tables
│   ├── asserts.ts                  #   elementAt, clamp, floorMod, assertNever
│   └── errors.ts                   #   one error root for the whole app
│
├── domain/                         # pure music logic — no DOM, no I/O, no time
│   ├── model/
│   │   ├── Pitch.ts                #   spelled pitch  ⇄ MIDI ⇄ staff position
│   │   ├── Duration.ts             #   interned rhythmic values, 480 divisions/quarter
│   │   ├── TimeSignature.ts        #   beat/measure tick arithmetic
│   │   ├── KeySignature.ts         #   accidentals + "spell this staff position"
│   │   ├── Clef.ts
│   │   └── Exercise.ts             #   Exercise/StaffPart/Measure/NoteEntry + validation
│   ├── timeline/Timeline.ts        # Exercise ➜ ordered expected events (cursor positions)
│   ├── matching/ChordMatcher.ts    # note-ons ➜ verdicts, with a tolerance window
│   ├── notation/
│   │   ├── MusicXmlSerializer.ts   # Exercise ➜ MusicXML 4.0 (IMusicXmlSerializer)
│   │   └── XmlWriter.ts
│   ├── generation/
│   │   ├── IExerciseGenerator.ts   # the generation port
│   │   ├── GrandStaffExerciseGenerator.ts
│   │   ├── RhythmFiller.ts         #   fills a bar exactly, without syncopation
│   │   ├── Rng.ts                  #   seeded, reproducible randomness
│   │   ├── ExercisePresetRegistry.ts
│   │   ├── presets.ts              #   the six built-in levels
│   │   └── voices/                 #   IVoiceGenerator strategies
│   │       ├── MelodyVoiceGenerator.ts
│   │       ├── HarmonyVoiceGenerator.ts
│   │       └── SilentVoiceGenerator.ts
│   └── scoring/
│       ├── PerformanceReport.ts    #   StepResult ➜ aggregated report
│       ├── IScoringStrategy.ts
│       └── strategies.ts           #   Accuracy | TimingWeighted
│
├── application/                    # orchestration; depends only on interfaces
│   ├── PracticeController.ts       # settings ➜ exercise ➜ render ➜ session ➜ cursor
│   ├── ports/                      # IMidiSource, IMetronome, IClock,
│   │                               # IScoreRenderer, IScoreCursor,
│   │                               # IExerciseProvider, IPitchPlayer
│   ├── session/
│   │   ├── PracticeSession.ts      #   the run: FSM, cursor, matcher, results
│   │   ├── SessionState.ts         #   the transition table
│   │   ├── SessionEvents.ts
│   │   └── PracticeContext.ts      #   the narrow view modes are given
│   └── modes/
│       ├── IPracticeMode.ts        #   + BasePracticeMode no-op defaults
│       ├── WaitMode.ts
│       ├── FlowMode.ts
│       └── PracticeModeRegistry.ts
│
├── infrastructure/                 # the only code that touches the platform
│   ├── midi/                       #   WebMidiAdapter, WebSocketMidiSource,
│   │                               #   ComputerKeyboardMidiSource, Composite…
│   ├── audio/                      #   WebAudioMetronome (look-ahead scheduler),
│   │                               #   WebAudioPitchPlayer, metronomeMath
│   ├── rendering/                  #   OsmdScoreRenderer, CursorNavigator
│   ├── time/SystemClock.ts
│   └── testing/                    #   MockMidiAdapter, ManualClock,
│                                   #   ManualMetronome, FakeScoreRenderer
├── composition/createApp.ts        # the composition root
└── ui/                             # AppView, dom helpers

tools/midi-bridge/                  # desktop relay: MIDI ➜ WebSocket ➜ tablet
tests/                              # mirrors src/, plus integration/
```

### The one idea that holds it together

An `Exercise` is the single source of truth, and **two** things are derived
from it:

```
                    ┌─ MusicXmlSerializer ─► MusicXML ─► OSMD ─► what you see
   Exercise ────────┤
                    └─ buildTimeline ──────► TimelineStep[] ──► what you must play
```

Because the printed page and the expected-event list come from the same value,
they cannot drift apart. A test asserts this directly: OSMD's own cursor
iterator visits exactly as many positions as our timeline has steps
(`tests/infrastructure/osmd-compatibility.test.ts`).

A `TimelineStep` is one cursor position: every note that starts at the same
musical instant, across both staves. A held bass note under a running melody is
demanded once, at its onset — exactly as a player experiences it. Rest
positions are kept as steps with nothing expected, because the engraver's
cursor stops there too.

### Judging what you play

MIDI does not deliver a chord; it delivers three note-ons a few milliseconds
apart, in any order. `ChordMatcher` collects them inside a configurable
tolerance window and reports the moment the expected set is complete:

- notes inside the window accumulate, in any order;
- a note arriving after the window starts a **fresh attempt** (so a hesitant
  half-chord is not silently completed a second later);
- `toleranceMs: Infinity` disables that rule, which is the friendly default for
  slow Wait-mode practice;
- `pitchClassOnly` ignores octaves, for beginners drilling note names.

### Modes, and why they are strategies

Wait mode and Flow mode differ in exactly two decisions: *when does the cursor
advance*, and *what counts as being on time*. `IPracticeMode` encapsulates just
those. The session owns everything else — lifecycle, subscriptions, the step
cursor, the results — and hands modes a narrow `PracticeContext` that can
report a verdict and finish a step but cannot touch the state machine.

Flow mode grades timing against the **scheduled** onset derived from the tempo,
never against the moment a tick callback happened to run, so audio-scheduler
jitter never reaches your score.

### Session lifecycle

```
  idle ──start──► counting-in ──countInComplete──► running ──complete──► completed
                       │                            │  ▲                    │
                       │                        pause│  │resume        start│
                       └────────abort───────────►  paused ◄──abort──────────┘
                                                     │                  ▼
                                                  aborted ──reset──► idle
```

The table lives in `SessionState.ts` as data, and every legal and illegal edge
is asserted in `tests/application/session-state.test.ts`.

### Ports and their adapters

| Port                 | Production adapter                              | Test double            |
| -------------------- | ----------------------------------------------- | ---------------------- |
| `IMidiSource`        | `WebMidiAdapter`, `WebSocketMidiSource`, `ComputerKeyboardMidiSource`, `CompositeMidiSource` | `MockMidiAdapter` |
| `IMidiConnection`    | `WebMidiAdapter`                                | `MockMidiAdapter`      |
| `IMidiDeviceDirectory` | `WebMidiAdapter`                              | `MockMidiAdapter`      |
| `IMetronome`         | `WebAudioMetronome`                             | `ManualMetronome`      |
| `IClock`             | `SystemClock`                                   | `ManualClock`          |
| `IScoreRenderer` / `IScoreCursor` | `OsmdScoreRenderer` / `CursorNavigator` | `FakeScoreRenderer` |
| `IExerciseProvider`  | `GeneratedExerciseProvider`                     | any stub               |
| `IPitchPlayer`       | `WebAudioPitchPlayer`                           | `SilentPitchPlayer`    |
| `IScoringStrategy`   | `AccuracyScoringStrategy`, `TimingWeightedScoringStrategy` | any stub    |

Everything is wired in one place, `src/composition/createApp.ts`. Nothing else
in the code base constructs an adapter.

## Testing

```bash
npm test           # ~300 tests
npm run coverage   # ~92% of statements in src/
```

The whole practice loop runs headless: a `ManualClock`, a `ManualMetronome` and
a `MockMidiAdapter` replay an entire performance — count-in, chord windows,
timing deviations, scoring — in milliseconds, with no hardware, no DOM and no
`setTimeout` (there is a test asserting that last part).

What the suite covers:

- **Domain** — pitch spelling and enharmonics, tick arithmetic, key signatures,
  exercise validation, timeline construction, chord matching (window restarts,
  duplicates, wrong notes, octave-insensitive mode), MusicXML structure and
  accidental rules, generator determinism and range/key constraints, scoring.
- **Application** — the session FSM, both practice modes end to end, controller
  orchestration and cursor synchronisation.
- **Infrastructure** — MIDI message decoding, device selection and hot-plug
  against a fake `MIDIAccess`; the Web Audio metronome's look-ahead scheduler
  against a fake `AudioContext` and fake timers; cursor navigation; and a
  contract test that the real OSMD parses what our serializer emits.
- **UI** — `AppView` is mounted against the real `index.html` markup in jsdom,
  so a renamed element id fails a test instead of the app.

Not covered: `OsmdScoreRenderer`'s own glue, which needs a real layout engine.
Its interesting part — translating absolute step indices onto a forward-only
cursor — lives in `CursorNavigator` and is fully tested.

## Extending it

**A new level.** Add an `ExercisePreset` to `presets.ts` (or register one from
anywhere): a generator plus the settings it was tuned for. It appears in the UI
automatically.

**A new kind of material.** Implement `IVoiceGenerator` — arpeggios, two-voice
counterpoint, chromatic passing notes — and hand it to
`GrandStaffExerciseGenerator`. Nothing else changes.

**A new practice mode.** Extend `BasePracticeMode`, override the hooks you care
about, register it. Adding a hook to the interface later cannot break existing
modes, because the base class supplies no-op defaults.

**A different grading policy.** Implement `IScoringStrategy` and return it from
`scoringFor(modeId)` in the composition root.

**Load MusicXML files instead of generating.** Implement `IExerciseProvider`.
The one piece of work is parsing MusicXML back into an `Exercise`, since the
timeline (and therefore the matcher) is derived from the domain model rather
than from the engraver's internals.

## Known limits and next steps

- Rhythms stop at sixteenth notes and one dot; no tuplets, ties or pickup bars.
- Generated music is deliberately simple — diatonic, no accidentals outside the
  key — though the notation layer already handles accidentals correctly.
- Notes are not coloured on the page when you get them right or wrong; feedback
  lives in the side panel. The side panel also still names the notes you owe,
  so hiding the cursor is not yet a full "read it blind" mode.
- No progress tracking between sessions yet: reports exist, but nothing stores
  them. Because every exercise is reproducible from its seed, "practise that
  one again" is a small feature away.

## Licence

MIT.
