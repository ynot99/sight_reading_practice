# Working in this repository

`README.md` explains what the app is and how it is structured — read it first.
This file only lists the rules that are easy to break.

## Layering

Dependencies point inwards: `ui`/`composition` → `application` → `domain`, with
`infrastructure` implementing application ports.

- `domain/` is pure: no DOM, no timers, no `Math.random`, no I/O. Randomness
  comes from the injected `Rng`, time from `IClock`.
- `application/` may not import anything from `infrastructure/`. It talks to
  ports only (`IMidiSource`, `IMetronome`, `IClock`, `IScoreRenderer`,
  `IExerciseProvider`, `IPitchPlayer`, `IScoringStrategy`).
- `infrastructure/` is the only place allowed to touch Web MIDI, Web Audio,
  OSMD or the DOM.
- Adapters are constructed in exactly one place: `src/composition/createApp.ts`.
  If you find yourself writing `new SomeAdapter()` anywhere else, that is the
  bug.

## Invariants worth protecting

- An `Exercise` is the single source of truth. The printed MusicXML and the
  matcher's timeline are both *derived* from it — never let one be edited
  independently of the other. `tests/infrastructure/osmd-compatibility.test.ts`
  asserts that OSMD's cursor and our timeline agree on the number of positions.
- Musical time is integer divisions (`DIVISIONS_PER_QUARTER = 480`). Do not
  introduce floating-point positions; convert to milliseconds only at the edge.
  `Duration.of` refuses a tuplet ratio that would not land on a whole division.
- Notation the writer chose is carried, not recomputed: beams, stem directions
  and clef changes all round-trip. Dropping one hands the engraver a decision
  that had already been made, and it will make a different one.
- A `StaffPart` is one *voice*, not one staff: several may share a
  `staffNumber`, which is how an inner line sits under a melody. Voice numbers
  are what must stay unique.
- An empty measure means the voice is *absent* from that bar, not resting - a
  rest is drawn and a silence is not. Allowed only while another voice on the
  same staff fills the bar; when none does, the staff rests and one voice has
  to carry it.
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
- `tests/fixtures/preset-digest.txt` pins what every built-in preset generates.
  Refactoring the generation layer must leave it byte-identical; a deliberate
  change to the ladder means regenerating it and reading the diff.
- The whole practice loop runs headless via `ManualClock`, `ManualMetronome`
  and `MockMidiAdapter` — no `setTimeout`, no sleeping, no hardware. Keep it
  that way; a test asserts it.
- **`npm test` does not typecheck.** Run `npm run typecheck` (or `npm run
  build`) before calling anything done — type errors in tests have slipped
  through a green suite before.
