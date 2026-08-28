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

**The ladder** is a route through those settings rather than a replacement for
them: twenty-four named rungs from a five-finger position in C to sequences in
E flat, moved along with the arrows. Each rung changes exactly one thing —
the material, the rhythm, the key or the metre — so a reader who comes unstuck
can say which of the four undid them; a rung arriving at new material states
all four, and a test holds the ladder to that. Two clean readings in a row
move you up, two that come apart move you down, and the streak restarts on
arrival so a fall cannot bounce straight back off the readings that preceded
it. Only whole readings of fresh material count: a repeated passage is
practice but not sight-reading, and an abandoned run is not a reading at all —
it also scores a flat 100% under accuracy grading, which counts the notes that
fell due rather than the ones in the exercise. Setting the material, rhythm,
key or metre by hand steps off the route and says so; tempo and bar count do
not, because slowing a rung down is how it is meant to be met.

**Practise bars** narrows the exercise to a passage. It is done by cutting
those bars out as a score in their own right rather than by teaching the session
to start and stop in the middle of a longer one, so the timeline, the page, the
cursor, the report and the playback all carry on unaware a longer piece exists.
The seams are the work: an inherited clef or key is stated at the head, a tie
leading out of the last bar is cut, and a pedal already down is pressed again.
Readings are remembered between visits, so the report can say whether a
passage is steadier than last time — a passage being the piece and the bars,
or the level when the material is generated, since one random exercise has no
lasting identity to improve on.

**Repeat when it ends** starts the passage over as soon as it finishes, and
**Drill the worst bars** picks the passage for you from the run you just
played — weighing steps the music took away above untidy ones, and ignoring
timing entirely, since being a little late throughout is a matter for the
tempo rather than a place to work.

**Listen** plays the exercise instead of judging it. The hand selector beside it
governs both listening and practice, because they are the same question asked
twice: which hand am I working on. Practising one hand is not practising half
the music — the page still shows both staves and the cursor still visits every
step; only what is demanded narrows. It is not a
practice mode: a mode exists to judge input and this judges nothing, so it is
its own service driven by the same pulse. Notes are handed to the instrument
*ahead* of when they sound, because a tick arrives after the moment it stands
for and a melody placed on delivery is audibly uneven. It is in the fullscreen
bar too: "how is this meant to go" is a question that comes up at the stand,
not at the desk. The cursor is shown for the performance whatever the reader
set, since following along is most of the value — and put back the way they
had it when the performance ends.

**Look before playing** is the only time you get with the music. Set it above
zero and the page is kept face down until you press Start; then you have those
seconds with it, and the run begins on its own.

Covering it is the whole feature, not decoration. A countdown alone enforces
nothing, because the unlimited staring happens *before* Start rather than
during the phase — the score is engraved the moment it is generated and sits
there until you are ready. Keeping it back is what turns the number into the
whole look, the way a scan before an audition is bounded by someone taking the
music away again. Asking to hear it played counts as spending the look.

**Blind mode** stops the panel spelling out the step that is due. Hiding the
cursor alone never quite worked, because the notes were still written in
letters beside the score and a reader who loses their place reads those instead
of the stave. The whole row goes rather than its text: "Play now —" reads as
*nothing is due*, and the count of notes left standing would still be half an
answer. The note log stops naming the rest of an unfinished chord for the same
reason. Bar and beat stay — knowing where you are is orientation, not an
answer.

**Rhythm only** judges when and never what: one press satisfies a step
whatever the pitch, because reading a rhythm before playing the notes is
standard practice and it is the half beginners drop first. It is a match rule
rather than a mode of its own, so it composes with either — nothing about when
the cursor moves changes.

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

**Only the count-in** is the same setting taken to its limit: you are given the
tempo and then left with it for the whole run, with no return to check against.
It is the dropout axis rather than a fifth click pattern, because a pattern
says *what a click marks* and governs the count-in too — "only the count-in"
as a pattern would leave the count-in's own pattern unsaid.

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

**Notes disappear** empties the page as the music goes by, and *where* it
empties is the setting. Once you have played them tidies up behind you and
demands nothing. Moved forward, it stops being tidying: at *as I reach them*
the note under your fingers is already gone, so it can only be played if it
was read a step earlier, and one step further makes that two.

That is one control rather than two, because dimming what is behind and
hiding what is under the hands are the same act at different distances — only
the distance decides whether the page is being decluttered or the reader is
being made to look ahead. Reading ahead is the skill the whole exercise is
for, which is also why the veil is never put in *front* of the reader: hiding
what is coming would train the opposite. Off by default.

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
│   │   ├── Duration.ts             #   interned rhythmic values incl. tuplets, 480/quarter
│   │   ├── TimeSignature.ts        #   beat/measure tick arithmetic
│   │   ├── KeySignature.ts         #   accidentals + "spell this staff position"
│   │   ├── Clef.ts
│   │   └── Exercise.ts             #   Exercise/StaffPart/Measure/NoteEntry + validation
│   ├── timeline/Timeline.ts        # Exercise ➜ ordered expected events (cursor positions)
│   ├── matching/ChordMatcher.ts    # note-ons ➜ verdicts, with a tolerance window
│   ├── notation/
│   │   ├── MusicXmlSerializer.ts   # Exercise ➜ MusicXML 4.0 (IMusicXmlSerializer)
│   │   ├── MusicXmlParser.ts       # MusicXML ➜ Exercise, with a dropped-feature report
│   │   ├── XmlNode.ts              #   DOM-free tree the parser reads
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
│       ├── troubleSpots.ts           #   report ➜ the bars worth drilling
│       └── strategies.ts           #   Accuracy | TimingWeighted | Continuity
│
├── application/                    # orchestration; depends only on interfaces
│   ├── PracticeController.ts       # settings ➜ exercise ➜ render ➜ session ➜ cursor
│   ├── ExercisePlayer.ts           # plays a score back, cursor and all
│   ├── PracticeHistory.ts          # how earlier readings of a passage went
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
`FigureWalker`. Figures are why `PatternVoiceGenerator` exists, and every level
is built from them: fluent reading is mostly recognising groups — a scale
fragment, a broken chord, a motif answered a step higher — and a line made of
independent random steps offers nothing to recognise. Everything is in scale
degrees, so a figure is in key and correctly spelled for free.

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

**Open a MusicXML file.** Already built: `Open MusicXML…` reads a score into an
`Exercise`, which is then practised like any other. It has to become one -
the timeline the player is judged against is derived from the exercise, and
building it from the engraver's parse of the same file instead would be the
drift the single source of truth exists to prevent. The model is narrower than
the format, so the import either refuses a file or reports what it dropped;
`MusicXmlParser` lists the cases. Several voices on a staff are kept as several
parts sharing a staff number, so a held note under a moving line stays a held
note; a voice absent from a bar is left out of it rather than resting through
it. Key and clef changes, stem directions and beaming are all followed as
written, along with rolled chords and the damper pedal. Grace notes, metre
changes and anything shorter than a sixteenth are the remaining limits.
Compressed `.mxl` files are unpacked on the way in, since that is what
MuseScore hands you unless you ask otherwise.

## Known limits and next steps

- Rhythms stop at sixteenth notes, one dot and triplets; no pickup bars.
  Sixteenths arrive in beamed pairs and triplets in complete threes, never
  singly and never straddling a beat.
- Values may cross a beat under the `syncopated` level, split at the boundary
  and tied. Everything else stays inside its beat, which is what keeps the
  other levels readable.
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
