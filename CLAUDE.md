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
