# Working in this repository

`README.md` explains what the app is and how it is structured — read it first.
This file is how the work is done here, and the rules that are easy to break.
`git log` is the history: every commit says what changed and why.

## What the app is for

- It is used mostly with imported scores, on a tablet in fullscreen and on a
  desktop, with Web MIDI in the browser. Reproduce a report under the settings
  it was made with — the frame, the count-in, play-to-start, the click — since
  each takes another path through the code.
- Two directions share the repo: a utility that makes reading easier, and a
  trainer of real sight-reading. Ask which one a request is for. Inside the
  trainer, an aid (note names, coloured notes, keys lit ahead, automatic
  slowing) takes away the work the exercise exists for: say so.

## How the work is done

- The owner decides and reviews every change. Reports to the owner are short
  and grouped by topic, with any question on its own **bold** line at the end.
- **Discuss first, one item at a time.** Propose the order and why, do one
  item, run the checks, show what changed, stop. A batch delivers decisions
  the owner never got to make.
- **Argue before building.** Say what a feature would actually measure or do,
  where it would live and what it costs, and say "don't build this" when that
  is the answer. Check first whether something already answers it. When the
  owner reaffirms after the objection, build it in full.
- **A description by appearance is a question.** Name the thing — say what it
  is a picture *of* — before changing or removing it.
- **Measure before claiming a cause.** Every report so far meant something
  other than its wording. Reproduce, print the numbers, then fix. Where only
  the device can answer (timing, memory, the keyboard, a tablet), add logging
  and say exactly how to reproduce, for the owner to run. Settings has "Copy a
  judging log" and For developers → start timings. Headless numbers are
  ratios between variants, never the browser's cost.
- A test "flaky under load" may be an unseeded exercise: view rigs generate
  from a fresh seed. Print the state on failure before blaming timing.

## Commits

- Straight to `main`. **Commit, never push**: a push runs the deploy, and the
  owner pushes. Before rewording anything, check `git status -sb` and
  `git log origin/main`; rewording a pushed commit needs a force push, which
  is the owner's call.
- Before committing: `npm run typecheck`, `npx vitest run` and `npm run build`,
  each exit 0.
- The subject is a plain sentence saying what changed — no prefix. The body
  says why: the cause found, what was measured, the tests and the mutations
  they caught. Never "as X does"; describe the mechanism.
- Stage explicitly. Never commit scores or MIDI files supplied for testing, or
  anything rendered from them — they are third-party arrangements, and every
  fixture here is synthetic. Never commit `.env`, nor any local file listed in
  `.git/info/exclude`.
- A tag names a version verified by hand. Tag before anything risky.

## The interface

- **Nothing in the transport row may change size**: it moves the buttons under
  a thumb already aiming. Text that changes lives in the notice pill beside the
  bar, out of the flow. Icons carry `title` as well as `aria-label`.
- Mid-run the bar folds to what is marked `data-mid-run`; anything else added to
  the row is hidden by default. On a narrow screen the row holds five buttons.
- **One question, one setting, one place.** The drawer holds only what a reader
  presses with hands on the keys: the passage and its places, note size, the
  hand. The left pill is what you open, the right one the takes. A control
  another setting has emptied is dimmed with a reason, never disabled.
- **No new checkboxes**: they multiply. Difficulty is chosen in Modes.
- **CSS holds the layout.** No JavaScript that measures a layout and corrects
  it; find the box that is the wrong size. JS asks only what CSS cannot know.
  No `backdrop-filter` over anything that repaints: it cost a quarter of the
  frames on an integrated GPU.
- Colours on keys, marks and rows are verdicts (Perfect / Good / Miss / Wrong).
  Do not light something nobody judged in a verdict's colour.
- Anything placed against a staff is measured from the printed page (Verovio's
  SVG), never from the model.

## Code idioms

- Comments say *why*, in full sentences. Names are phrases that say what a
  thing is for (`theNotesAskedFor`, `letGoOfTheReplay`).
- Do not quote the owner in code, comments or commit messages: give the
  reason in the program's own terms. The `His:` quotes already in the code
  stay as they are; none are added.
- No workarounds. When state goes out of step, find the event that should have
  said so; do not reconcile it inside a render method. State lives in the
  controller and the model and is never read back from the DOM.
- One answer, worked out in one place. Look before writing a helper: the keys
  a step strikes are `notesStruckAt`, a note's sounding length `soundsFor`,
  the keys down a moment into a run `theKeysDownAt`, the score as a roll
  `rollOfTheScore`. Two loops working out the same thing will come to
  disagree, and then nobody can say which was right.
- Timers belong to `ui/`. The application layer is driven through the clock
  and metronome ports.

## Layering

Dependencies point inwards: `ui`/`composition` → `application` → `domain`, with
`infrastructure` implementing application ports.

- `domain/` is pure: no DOM, no timers, no `Math.random`, no I/O. Randomness
  comes from the injected `Rng`, time from `IClock`.
- `application/` may not import anything from `infrastructure/`. It talks to
  ports only (`IMidiSource`, `IMetronome`, `IClock`, `IScoreRenderer`,
  `IExerciseProvider`, `IPitchPlayer`, `IScoringStrategy`).
- `infrastructure/` is the only place allowed to touch Web MIDI, Web Audio,
  Verovio or the DOM.
- Adapters are constructed in exactly one place: `src/composition/createApp.ts`.
  If you find yourself writing `new SomeAdapter()` anywhere else, that is the
  bug.

## Invariants worth protecting

- An `Exercise` is the single source of truth. The printed MusicXML and the
  matcher's timeline are both *derived* from it — never let one be edited
  independently of the other. `tests/infrastructure/verovio-compatibility.test.ts`
  asserts that the page Verovio draws and our timeline agree: every note and
  rest a step names is drawn, and everything drawn is some step's.
- Musical time is integer divisions (`DIVISIONS_PER_QUARTER = 3360`). Do not
  introduce floating-point positions; convert to milliseconds only at the edge.
  `Duration.of` refuses a tuplet ratio that would not land on a whole division.
  The number is a claim about which tuplets exist - it divides by 2, 3, 5 and
  7 - and it has changed once already, so say `Duration.QUARTER.ticks` and
  never a bare tick count, in tests above all.
- Two things may change partway through a piece, and each takes an answer away
  from multiplication. A metre change moves the bar lines, so every musical
  *position* is read off `barLines`. A tempo change moves the clock, so every
  *time* - how long a stretch lasts, when a note sounds, how long a subdivision
  is - is read off `elapsedMsAt` / `spanMs`, and the metronome is handed its
  tempo spans exactly as it is handed its bars. `ticksToMilliseconds` takes one
  bpm and so is only ever right inside one span.
- A repeat is written out, not jumped back to. `unrollRepeats` reads the score
  in playing order and each re-read bar keeps the number it has in the file,
  which `barLabels` carries. Everything this program draws moves forward - the
  marker, the page, the veil, the marks left where the reader played - and two
  readings of one printed page would have to share all of it.
- An ornament takes no time from the bar. A grace note is carried on the entry
  it leans on, never in the entry list: given real time it has to be paid for,
  and both payments are wrong. The engraver gives it no cursor position, so
  neither does `buildTimeline` - it goes into `ornamentMidi`, which the matcher
  accepts and never waits for.
- A generated tie holds one pitch: the voice must stop moving for the length
  of the held note, or `validateExercise` will refuse the bar.
- Practising a passage gives the *run* two ends; the music on the page stays
  whole. `startAtIndex` and `stopAfterIndex` are the whole mechanism, and
  beginning partway through is the same two numbers resuming from a pause has
  always used. This replaced cutting the score down to the passage, which
  needed the clef and key restating, a tie out of the last bar letting go of
  and the pedal pressing again - seams that only existed because something had
  been cut. The reader keeps their context and the bar numbers keep meaning
  what they say.
- Notation the writer chose is carried, not recomputed: beams, stem directions
  and clef changes all round-trip. Dropping one hands the engraver a decision
  that had already been made, and it will make a different one.
- A `StaffPart` is one *voice*, not one staff: several may share a
  `staffNumber`, which is how an inner line sits under a melody. Voice numbers
  are what must stay unique.
- A rest is drawn and a silence is not, so the two are different entries. An
  empty measure means the voice is absent from that whole bar; a `silence`
  entry means it is absent for part of one, takes its time so the bar still
  adds up, and is written as a rest carrying `print-object="no"`. It was
  `<forward>`, which is the format's own word for the same thing and which
  OSMD laid out wrongly: measured on Clair de Lune bar 47, a voice entering
  at the end of the bar had its notes drawn at the *beginning* of it. Read
  back, an invisible rest is a silence again - otherwise a score kept in the
  library gains rests nobody wrote. Neither may leave the *staff* blank:
  `validateStaffCoverage` walks every bar and demands that its voices between
  them draw something across the whole of it, and the importer gives a rest
  back wherever they do not.
- Tuplet groups are *inferred*, not stored: a group closes when its accumulated
  span becomes a plain notatable value. Values shorter than a group's share of
  the beat must never reach `largestThatFits`, which knows only plain values.
- A tie is one press, not two. `buildTimeline` must never demand a tied note
  again, and must still create the step the engraver draws there - the cursor
  and the timeline agree on *positions*, not on what is expected at them.
- Generators must produce exercises that pass `validateExercise` for every key
  and time signature offered in the UI. There is a sweep test for this.
- Exercise generation is seeded and must stay reproducible: same seed and
  request ⇒ identical notes.

## Conventions

- TypeScript is strict, including `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax`. Use `import type` for types, and **`.js` extensions**
  on relative imports.
- No `enum`; use string-literal unions. No parameter properties in
  constructors; declare fields explicitly.
- Prefer `elementAt(...)` over `arr[i]!` — non-null assertions hide real bugs.
- No `// TODO` placeholders. Land the whole implementation or leave the seam as
  an interface with a documented reason.

## Testing

- Every rule in `domain/` and `application/` gets a test. New practice modes,
  voice generators, rhythm profiles and scoring strategies need one each.
- **Every new test is mutation-checked**: break the smallest thing it covers
  and watch it fail, for the stated reason. A test that passes anyway is
  strengthened or deleted; a rule no test can reach is deleted. Pin the
  property, not the mechanism.
- Where a threshold decides, sweep the whole band rather than picking cases —
  `tests/application/note-marks.test.ts` is the model.
- jsdom applies no stylesheet. Layout rules are held in
  `tests/ui/stylesheet.test.ts`, which reads the text — so a rule found there
  proves the file says it, not that it wins. Check specificity and order.
- A test of a reload builds a fresh page (`mountRealMarkup()`) before the
  second rig, or it reads back what the first one set.
- `tests/fixtures/preset-digest.txt` pins what every built-in preset generates.
  Refactoring the generation layer must leave it byte-identical; a deliberate
  change to the ladder means regenerating it and reading the diff.
- The whole practice loop runs headless via `ManualClock`, `ManualMetronome`
  and `MockMidiAdapter` — no `setTimeout`, no sleeping, no hardware. Keep it
  that way; a test asserts it.
- **`npm test` does not typecheck.** Run `npm run typecheck` (or `npm run
  build`) before calling anything done — type errors in tests have slipped
  through a green suite before.
- Never `git checkout -- <file>` to undo a temporary edit in a file with
  uncommitted work; copy the file first and copy it back.
