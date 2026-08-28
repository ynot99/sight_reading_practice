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

The click is a practice setting of its own: it can sound every beat, halve or
third it, or give only the downbeat and leave the pulse inside the bar to you.
It is deliberately separate from the rate the practice loop runs at, which is
derived from the shortest note in the exercise — one number cannot both resolve
sixteenths and click once a bar. Compound metres are counted as they are felt:
6/8 is two dotted quarters, not six eighths, and a count-in is a bar long
whatever that works out to.

The click can also be told to drop out: two bars of pulse, two bars where you
carry it alone, and you find out on its return whether you drifted. The
count-in is never dropped, and a silent bar is silent to its downbeat — a click
on the first beat would answer the only question the exercise asks.

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

### Seeing what you played

Each press is drawn over the engraving at the pitch actually struck: a green
ring where the note belonged, a red one where it did not, with an accidental
and ledger lines so a mark can never claim a pitch that was not played. The
printed notes are never recoloured - reading black noteheads is the point of
the exercise.

The geometry is measured from notes the engraver has already drawn rather than
assumed, so zoom, engraving rules, or a different engraver cannot silently
slide the marks off their notes. A test renders a real score and checks the
marks land on the printed staff lines.

**Fade notes once passed** empties the page behind you as the music goes by,
which pushes the eye forward instead of letting it rest on what has already
been read. Off by default.

### The piano sound

Notes you play are sounded with real piano recordings, so a MIDI controller
with no speakers of its own still sounds like an instrument.

The source library - the [Salamander Grand
Piano](https://archive.org/details/SalamanderGrandPianoV3), CC-BY 3.0 - is
1.9 GB, which no browser is going to download. What ships is a reduction of it:
one velocity layer, one note every three semitones, six seconds long.
**1.0 MB in total**, trimmed by stream copy so the audio itself is untouched.
The notes in between are covered by resampling the nearest recording, never
more than a semitone away.

When they load is a setting: with the page, on the first key press (the
default, so an idle visit costs nothing), or not at all. A synthesised tone
covers the notes until they arrive, and stands in permanently when the
download is switched off. The sustain pedal is followed too: a
released key keeps ringing while the pedal is down, and is damped when it
comes up. See
[public/samples/piano/CREDITS.md](public/samples/piano/CREDITS.md).

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

The space bar starts, pauses and resumes, so a run can be driven without
reaching for the mouse. It steps aside whenever a control has focus, since
that is how buttons and checkboxes are worked.

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
│   │   ├── presets.ts              #   the eight built-in levels (material)
│   │   ├── RhythmProfile.ts        #   voice roles + the profile registry
│   │   ├── rhythmProfiles.ts       #   the rhythmic levels (calm ➜ sixteenths)
│   │   └── voices/                 #   IVoiceGenerator strategies
│   │       ├── MelodyVoiceGenerator.ts
│   │       ├── PatternVoiceGenerator.ts
│   │       ├── figures.ts          #     scales, arpeggios, sequences
│   │       ├── HarmonyVoiceGenerator.ts
│   │       └── SilentVoiceGenerator.ts
│   └── scoring/
│       ├── PerformanceReport.ts    #   StepResult ➜ aggregated report
│       ├── IScoringStrategy.ts
│       ├── ScoringStrategyRegistry.ts
│       └── strategies.ts           #   Accuracy | TimingWeighted | Continuity
│
├── application/                    # orchestration; depends only on interfaces
│   ├── PracticeController.ts       # settings ➜ exercise ➜ render ➜ session ➜ cursor
│   ├── SettingsRepository.ts       # what you chose last time, validated on the way in
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
│   │                               #   SampledPitchPlayer, WebAudioPitchPlayer
│   ├── rendering/                  #   OsmdScoreRenderer, CursorNavigator
│   ├── storage/                    #   LocalStorageSettingsStore
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
jitter never reaches your score. A press landing just before a beat is held
back and judged against the note it was reaching for, rather than counted as a
wrong note added to the one going out.

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
| `IScoreRenderer` / `IScoreCursor` / `IPlayedNoteOverlay` / `IScoreZoom` | `OsmdScoreRenderer` / `CursorNavigator` | `FakeScoreRenderer` |
| `IExerciseProvider`  | `GeneratedExerciseProvider`                     | any stub               |
| `ISettingsStore`     | `LocalStorageSettingsStore`                     | `InMemorySettingsStore` |
| `IVolumeControl`     | `WebAudioMetronome`, `WebAudioPitchPlayer`      | any stub               |
| `IPitchPlayer` / `ISustainPedal` | `SampledPitchPlayer` (falls back to `WebAudioPitchPlayer`) | `SilentPitchPlayer` |
| `IScoringStrategy`   | `AccuracyScoringStrategy`, `TimingWeightedScoringStrategy` | any stub    |

Everything is wired in one place, `src/composition/createApp.ts`. Nothing else
in the code base constructs an adapter.

## Testing

```bash
npm test           # ~460 tests
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

**A new rhythmic level.** Add a `RhythmProfile` to `rhythmProfiles.ts`. Material
and rhythm are separate axes — a preset says which pitches and how far they
leap, a profile says what every `VoiceRole` (`lead`, `inner`, `accompaniment`)
does rhythmically — so a new profile combines with every existing preset instead
of multiplying the level list. Short values that are only readable in groups
carry `repeat` in their pool; the group is all-or-nothing against the beat.

**A new kind of material.** Implement `IVoiceGenerator` — two-voice
counterpoint, chromatic passing notes, walking bass — and hand it to
`GrandStaffExerciseGenerator`. Nothing else changes.

**Marks that show *when*, not just *what*.** A played note is drawn at its
step's notehead, shifted by how early or late the press was as a fraction of
the gap to the neighbouring note. The application works out the fraction from
the timeline, the renderer turns it into pixels, and neither has to know the
other's units. Only Flow mode offsets anything: in Wait mode the music holds
still until you play, so a slow answer is not lateness.

**A new melodic figure.** Add a kind to `FIGURE_KINDS` and a shape to
`FigureWalker`. Figures are why `PatternVoiceGenerator` exists: fluent reading
is mostly recognising groups — a scale fragment, a broken chord, a motif
answered a step higher — and a line made of independent random steps offers
nothing to recognise. Everything is in scale degrees, so a figure is in key and
correctly spelled for free.

**A new practice mode.** Extend `BasePracticeMode`, override the hooks you care
about, register it. Adding a hook to the interface later cannot break existing
modes, because the base class supplies no-op defaults.

**A different grading policy.** Implement `IScoringStrategy` and register it.
Grading is its own axis: a mode names the policy it is usually judged by, but
the reader can grade any mode by any of them. Three ship — the notes alone, the
notes and their timing, and how far the run got without breaking.

**A new click pattern.** Add it to `CLICK_PATTERNS` and say how many clicks a
beat holds in `clicksPerPulse`. `subdivisionsPerPulseFor` takes the lowest
common multiple of that and what the music needs, so the loop automatically
ticks often enough to sound it.

**Load MusicXML files instead of generating.** Implement `IExerciseProvider`.
The one piece of work is parsing MusicXML back into an `Exercise`, since the
timeline (and therefore the matcher) is derived from the domain model rather
than from the engraver's internals.

## Known limits and next steps

- Rhythms stop at sixteenth notes and one dot; no tuplets, ties or pickup bars.
  Sixteenths arrive in beamed pairs, never singly.
- Generated music is deliberately simple — diatonic, no accidentals outside the
  key — though the notation layer already handles accidentals correctly.
- The side panel still names the notes you owe, so hiding the cursor is not yet
  a full "read it blind" mode.
- No progress tracking between sessions yet: settings are remembered on the
  device, but performance reports are not stored. Because every exercise is
  reproducible from its seed, "practise that one again" is a small feature
  away.

## Licence

MIT.
