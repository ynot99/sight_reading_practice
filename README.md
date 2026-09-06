# Piano Sight-Reading Trainer

A client-side sight-reading trainer for piano: it generates fresh grand-staff
exercises, engraves them as real notation, and judges what you play on a MIDI
keyboard in real time. Free, open source, and offline after the first load —
an alternative to the graded sight-reading drills the subscription trainers
sell.

Around those two modes are the aids a reader reaches for: a **ruler** of the
beat drawn through bars spaced by time rather than by an engraver, the **other
hand** sounded while you read yours, a **click that follows you** instead of
counting at you, a page that turns **in halves**, and a reminder to **stop**
that waits for the music to stop first. Each of them is described further
down; every one of them is off until asked for.

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

A score opened from disk is **kept**, and appears in a list beside the page:
the file is chosen once and afterwards the piece is simply there. What is
stored is the MusicXML this project's own serializer produces, in the
browser's database rather than beside the settings — a hundred bars is about
320 kB, which would fill key-value storage in a handful of pieces. The
document rather than a serialised `Exercise` because the round trip through
the serializer and the parser is exact, measured on the real test file and
byte for byte, so there is one representation to keep correct instead of two
— and what is on disk stays a format other programs can read.

**Hold a finger on a bar** to mark it. What the hold does is decided by what
is already standing on *that bar*, so it can be read off the page rather than
counted:

- a bar **outside** what is being practised clears the passage and puts the
  place there — a reader holding somewhere else is beginning somewhere else,
  not stretching the passage to reach a bar they never said belonged to it;
- a hold on the bar **the place is on** opens the passage there;
- a hold **inside** the passage, with the near end already standing, is the
  far end. On the near end's own bar that makes a passage of one bar, which is
  the quickest thing anyone wants; further along it takes in everything
  between.

So bars 9 to 12 are: hold 9, hold 9, hold 12. And bar 9 alone is: hold 9,
hold 9, hold 9.

Which mark it is could instead have been said by *where in the bar* the finger
landed, near the bar line against the middle of it, and that is a distinction
a fingertip cannot reliably make: a bar is a couple of centimetres and a
fingertip is one, so a third of the misses would place the wrong mark. A
double tap was the other candidate, and it costs either a quarter-second of
waiting on every tap — including the grip taps that nudge the passage a bar
at a time, which are pressed in a row — or a first tap that acts and is then
undone.

**Hold a finger on a marker** to shut the passage onto the one bar it stands
at: the near marker pulls the far one back to the end of its own bar, the far
one pulls the near one up to the start of its own. A tap on a marker's grip
still nudges the passage a bar, and dragging one still moves it.

Whole bars throughout, because that is what a passage is made of and where a
musician starts. A run beginning halfway through a bar would be counted into
a beat that is not the first, and the reader would be waiting for a downbeat
that never came.

**Bars** in the drawer say the same passage in figures, for when a number is
what you have rather than a place on the page: which bars to read is changed
between attempts, not dialled in once. Asking for a new exercise empties it —
bars 12-16 of the piece just closed mean nothing in the one opening.

**A passage gives the run two ends; the music on the page stays whole.** A
start index and a stop index are the whole mechanism, and beginning partway
through is the same pair of numbers that resuming from a pause has always
used.

It was done the other way first — the bars were cut out as a score in their
own right, so that the timeline, the page, the cursor, the report and the
playback all carried on unaware a longer piece existed. What that bought in
simplicity it spent on seams, and the seams were all of the work: an
inherited clef and key had to be restated at the head, a tie leading out of
the last bar had to be let go of, a pedal already down had to be pressed
again. Every one of those existed only because something had been cut. Left
whole, the reader keeps their context — the bar before the passage is still
there to be seen — and the bar numbers go on meaning what they say.

Readings are remembered between visits, so the report can say whether a
passage is steadier than last time — a passage being the piece and the bars,
or the level when the material is generated, since one random exercise has no
lasting identity to improve on.

**Start when you play the first notes** listens to the keyboard while nothing
is running and begins the run the moment the opening the page asks for has
been played — with no count-in, since the reader has just set the tempo
themselves by playing it. Their hands are already on the keys, and reaching
for the tablet to begin and reaching back is most of what starting costs. The
chord that started it is *credited*, not asked for again: it goes through the
same path as any press landing just ahead of the first beat. What it waits
for is the chord the run would actually begin with, so a place put somewhere
else or a passage chosen moves it too, and it is judged by the same matcher
the run would use — the reader's tolerance, their octave rule, the ornaments
the page offers but does not demand. Wrong notes are not punished: nothing is
being graded yet. It lives in the fullscreen drawer as well as in the
settings, because a setting whose point is not reaching for the tablet should
not be two taps deep.

**Repeat when it ends** starts the passage over as soon as it finishes. When
it is *heard* rather than played it goes round inside the one performance:
the metronome never stops and the notes of the next round are handed to the
instrument while the last of this one are still sounding, so the seam costs
nothing at all. It used to be a whole new performance, and stopping and
starting re-anchors the metronome to the audio clock a fixed lead ahead of
now — a reader tapping along heard the repeat come in late. The plan is laid
end to end with the music: only the passage's own bars, since what follows it
in the piece is not what comes next when it plays again.

**Drill the worst bars** picks the passage for you from the run you just
played — weighing steps the music took away above untidy ones, and ignoring
timing entirely, since being a little late throughout is a matter for the
tempo rather than a place to work.

**Listen** plays the exercise instead of judging it. Pressing it again holds
the music where it is and pressing it once more picks it up: it is the same
button that started the performance, and pressing a play button a second time
does not mean "back to the top" anywhere else — it used to here, so hearing a
phrase twice meant sitting through everything in front of it again. **Stop**
is what ends a performance, as it ends a run or a look. Only the place is
held: what to play, how fast, with what click and how much of it are read from
the settings again on the way back in, so a passage moved during the pause
takes effect.

**Which hand** is asked on the page itself: a switch in the margin beside each
staff, repeated down the page the way a clef is, so there is one within reach
of wherever the eye happens to be. Press the upper one and the upper staff
stops being asked for. It needs no icon to be understood and no memory to be
found — it is beside the notes already being looked at — and it takes nothing
from the transport row. The drawer's button cycles the same setting for
anyone who prefers a button; they cannot come to hold different answers.

The setting has three states and the switches are two, so turning off the
last hand still standing is read as putting them both back: a run that asks
for nothing is not a thing anyone means, and a switch that silently refused
would be a switch that sometimes does nothing with no way of saying why.

It governs both listening and practice, because they are the same question
asked twice: which hand am I working on.

**Dim what this run will not ask for** answers it on the page as well. The
hand that is not being read and the bars outside the chosen passage are the
same thing from the reader's side: notation still worth having there — the
neighbours say what the passage is a passage *of*, and the other hand says
what this one is playing against — but not what is being asked for now. So
they are dimmed rather than taken away, and nothing like as far as a note
already played, which goes altogether: one is behind you and finished with,
the other is context and has to stay readable. It is a setting, and off means
the page says nothing about it at all. Practising one hand is not practising half
the music — the page still shows both staves and the cursor still visits every
step; only what is demanded narrows. In Wait mode the run walks past the steps
that hand has nothing in — a held right hand while the left keeps moving is no
more this reader's to play than a rest is. It is not a
practice mode: a mode exists to judge input and this judges nothing, so it is
its own service driven by the same pulse. Notes are handed to the instrument
*ahead* of when they sound, because a tick arrives after the moment it stands
for and a melody placed on delivery is audibly uneven. A chord the writer
marked to be rolled is rolled, low note to high, and a roll written across
both staves is one gesture rather than two at once. It *starts* on the beat
instead of arriving there — the cursor and the click are both at that step, so
a roll finishing on the beat would put the lowest note, the one carrying the
harmony, audibly early against both. The spread is capped at half the step, or
the delay that sounds right at a walking tempo would run a five-note chord
into the chord after it at speed. The cursor is shown for the performance whatever the reader
set, since following along is most of the value — and put back the way they
had it when the performance ends.

The transport is one row of icons: play/pause as a single button, stop,
listen, the pace, the metronome, and repeat. A drawer under it — opened by
its handle or by dragging up — holds what you *change* rather than what you
press mid-run: note size, which hand, the cursor, the marks for what you
played, survival, a fresh exercise.

Repeat is in the row and a fresh exercise is not, which is a swap rather than
a widening: the row is as short as it was. A new exercise does nothing at all
while a real score is open — the controller sees the opened piece and
presents it again — so for most of the reading done here it is a button that
cannot be pressed usefully, while repeat is how a passage is learned.

The metronome is in the row rather than the drawer because it is the thing
reached for most between runs, and a drawer is a gesture before it is a
button.

Which hand is one button carrying all three answers, cycling both → left →
right. Both hands are always drawn and the one not being read is dimmed, so
the control shows its own state instead of naming it.

**Nothing is said in words beside the bar.** There was a pill there, and one
by one everything it said turned out to be said better by the page itself:
which piece opened is printed in the page's corner, which bars are being
practised is where the markers are standing, where the run starts is where
the start flag is, what the countdown is on is the number in the middle, and
the grade is the card. What is left of it — "Idle", "Playing" — the play
button's own icon says.

It did once say where the run had got to, and "bar 12 · beat 2.5" changed
several times a second on music of any density and changed width with it: a
smear rather than a number anyone could read. The cursor is on the note and
the bar numbers are printed on the page.

The transport row still holds only things that do not change size, which is
the rule that pill existed to keep — a lesson four separate indicators taught
the hard way.

A **failure** is said in the middle of the page, over the music, where every
other failure is said: a file that will not open, a piece no longer stored.
What a file merely *lost* on the way in — a feature the importer dropped —
goes to the console instead. Those warnings are worth keeping, since several
faults here were found through one, and they are not worth a line across the
music.

**While the music is going the interface goes away.** The bar loses its own
ground and everything in it but two buttons — pause and stop — which are left
floating over the score where the transport was. A reader mid-piece has their
hands on the keys and their eyes on the page, so anything else there is
something to look past. A pause does not bring it back and stopping does,
which is the whole difference between the two buttons; the look before a run
counts as playing, the look being reading. The markup marks what *stays*
rather than what goes, so a button added to that row is out of the way by
default.

**The middle of the page** is where anything that has to be said in words is
said. A countdown — the look before a run, then the metronome's count-in — is
drawn there huge and faint, over the music rather than instead of it: what
the reader is doing while it runs is reading the first bar. And the verdict
on a finished run goes there as a panel, with the breakdown and **Drill the
worst bars** in it. So does a failure. A tap puts it away, and so does
starting anything.
Each number is said once: the status lines say *what* is happening, the
middle of the page says how much of it is left.

In fullscreen the pace is a **percentage of the written tempo**, moved five
points at a time. A percentage rather than a number of beats because the
written tempo changes from piece to piece: "a bit slower" is the same gesture
at 60 and at 132, and 100% always means as written. It is derived from the
material rather than stored, so it cannot drift out of step with the music on
screen — an opened score brings its own tempo, a generated one takes its
level's. Changing it does *not* redraw the page: a printed score states the
tempo its writer chose and says nothing about how fast anyone is playing it
today, so the page is engraved from the score as written and the transport
says what the run is actually taken at. Engraving a long score is two and a
half seconds against thirty milliseconds to write the file, so a nudge that
redrew it spent nearly all of that on notes nobody had touched.

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
reason.

**Survival** is the game mode: a bar drains while the music runs and fills
when you get a step right, and running out ends the run. It is deliberately
not a way of grading sight-reading — coming apart on a page you have never
seen is the material working, not you failing — it is for music you already
know, where the question is whether it holds together at tempo.

The drain is measured in *beats of musical time*, not in seconds, and that is
the whole of how a slow melody stays playable: a beat at 50 bpm lasts more
than twice as long as one at 120, so the bar falls at half the speed on screen
without anything being told the tempo. Per beat rather than per pulse, too —
sixteenths tick four times as often as quarters and must not cost four times
as much for a reason no player could name. Busy music is still harder, because
there are more notes to miss, which is the point rather than an accident.

Where the music waits for you there are no beats going past to count, so the
bar is drained by the clock instead and every beat you find fills it outright:
ten seconds from full to empty, which is room to read a chord you have not met
and not room to work out the whole bar. Under the pulse the bar is driven by
the run's own metronome, so a whole game replays headlessly in a test, and the
glide is timed from the gap between pulses — a fixed one would stutter on a
slow piece and lag behind on a fast one.

**Rhythm only** judges when and never what: one press satisfies a step
whatever the pitch, because reading a rhythm before playing the notes is
standard practice and it is the half beginners drop first. It is a match rule
rather than a mode of its own, so it composes with either — nothing about when
the cursor moves changes.

Everything about the click lives behind one button on the transport bar —
what it marks, how much of the run it sounds for, how many bars it counts in,
and how loud it is. It was in three places before: two cycle buttons under the
drawer handle and two sliders down the settings sheet, so "quieter, and give
me two bars of count-in" meant both of them and a scroll. They are one
subject, and the button says what they add up to without being opened.

The click is a practice setting of its own: it can sound every beat, halve or
third it, or give only the downbeat and leave the pulse inside the bar to you.
It is deliberately separate from the rate the practice loop runs at, which is
derived from the shortest note in the exercise — one number cannot both resolve
sixteenths and click once a bar. Compound metres are counted as they are felt:
6/8 is two dotted quarters, not six eighths, and a count-in is a bar long
whatever that works out to — in the metre the music is about to *begin* in,
which for a piece that changes metre is not always the one it opened in.

The click can also be told to drop out: two bars of pulse, two bars where you
carry it alone, and you find out on its return whether you drifted. The
count-in is never dropped, and a silent bar is silent to its downbeat — a click
on the first beat would answer the only question the exercise asks.

**Only the count-in** is the same setting taken to its limit: you are given the
tempo and then left with it for the whole run, with no return to check against.
It is the dropout axis rather than a fifth click pattern, because a pattern
says *what a click marks* and governs the count-in too — "only the count-in"
as a pattern would leave the count-in's own pattern unsaid.

### A knob on the keyboard

Any knob, slider or wheel can be taught to drive the note volume: press **Use a
knob** beside the volume slider and turn it. Nothing is guessed — there is no
standard controller number for a volume knob, 7 and 11 are both common and a
manufacturer may choose anything, so a table of guesses would be wrong for
somebody. Turning the knob is the one description that is always accurate, and
it works for a keyboard nobody has tested.

While it waits, it says what is arriving — `Heard CC 1 at 42%` — even from a
control you did not mean. A screen that only waits cannot tell you whether the
knob sends anything at all, and some knobs really are analogue; silence on that
line is itself the answer.

Learning waits for a few *distinct positions* rather than one message, because
a keyboard announces bank selects and modes on connect and any of those would
otherwise be learned instantly and then never move again. The knob writes
through the volume slider rather than past it, so the two can never disagree
about how loud the piano is. Knobs travel over the desktop bridge too — the
tablet is where the reader is, and it can only learn what reaches it.

### Finding the piece you want

The library is ordered by when each score was last *read*, which took some
doing: it always said so and always sorted on when the file was imported,
which is the same order only on the day everything arrived. A score is stamped
when the reader chooses it or starts a run on it - not when the program opens
one by itself, since a machine's choice is not a reading and would push
whatever it offered to the top of the list every visit. Each row says how long
ago in days, because an order nobody can see the reason for reads as no order
at all.

A search box narrows the list, matching every word in any order: these are
MuseScore arrangements called things like "Hollow Knight - City of Tears", and
what anyone remembers of that is "city tears". A score can be renamed, and the
new name goes into the *document* rather than only into the row - the title is
printed in the corner of every page, and a library that disagreed with the
page would be worse than either name alone. What the reader has read and how
well follows the name across.

Emptying the whole shelf asks for the word to be typed. It sits a thumb's
width from the button that forgets one score, and what each costs is not
remotely the same.

### What is on the stand when you open it

Three answers: a new exercise, the piece you read last, or one of your own
scores at random - his idea, from osu, that something is in front of you and
the question becomes whether to play it rather than what to play. Generating
is the quick way in and stays the default, because the library lives in a
database that answers later than the page draws.

### Keeping what you played

The recorder runs from the moment the page opens, and the red **Keep** button
does not start it — it keeps what already happened. That is the
whole design: an idea worth saving is one you notice *after* playing it, so a
Record button would arrive after the thing it was for. The button says how much
it is offering, and a take is cut at the last pause longer than four seconds,
which is where a musician would cut it anyway.

Kept takes appear in a list beside the score, each exportable as a Standard
MIDI File or deletable. What is stored is the *performance* — the note-ons,
note-offs and pedal, with their real timings — and the file is written from it
on export, for the same reason an `Exercise` and not its MusicXML is what this
project keeps. Nothing is quantised: free playing has no tempo to discover, and
a guess that moved the notes would not be a capture.

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

### On an iPad

Add it to the Home Screen. Launched from there, iPadOS runs it without any of
Safari's chrome — which is the only way to be rid of the floating close button
and the swipe-down that fullscreen brings. Neither can be turned off from a
page, deliberately: a browser has to leave the reader a way out of fullscreen.
Standalone is not fullscreen, so there is nothing to leave, and the app skips
asking for it rather than handing the furniture back.

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

**When** they appear is a setting of its own: as you play them; as you play
them with a wrong one lasting only while you hold the key; only when the run
ends; or never. The third of those is for hunting an accidental, where every
try leaves a red note behind and by the tenth the note being hunted for is
underneath them - so a wrong one is *lent* to the page rather than given to
it, and they all come back when the run ends, which is when they are worth
reading. Only the red is lent: what was played correctly is the reading
itself, and a page emptying as the fingers left it would show nothing at all
by the end of a bar.

A right note is drawn palely until every note of its beat has been found. A
chord half found is not a chord, and the only other way to tell the two apart
is to count noteheads against the printed ones - which is the reading the mark
was supposed to be helping with. Holding them back leaves the page exactly as the engraver
drew it for the whole reading, which matters because reading is the task — a
mark arriving under your eyes is an answer to a question you have already
answered. The whole reading then goes up at once, including when you stop
part-way, since stopping is a decision to look at what happened.

One axis rather than two switches: "draw them" and "draw them now" are the
same question at different moments, and two controls would let a reader ask
for marks that are hidden. What is drawn is identical either way — the timing
offset is measured while the run still knows its tempo, not at the end.

The report says **how scattered** the presses were as well as how late: "12 ms
late · ± 9 ms" is a habit to correct, while "12 ms late · ± 40 ms" is a
precision problem. The two are different faults and the average alone cannot
tell them apart — and if the scatter appears only on the tablet, it is not the
reader at all but the path the notes travelled. Which is why the bridge now
stamps a press at the source: see `tools/midi-bridge/README.md`.

The geometry is measured from notes the engraver has already drawn rather than
assumed, so zoom, engraving rules, or a different engraver cannot silently
slide the marks off their notes. A test renders a real score and checks the
marks land on the printed staff lines.

**Notes disappear** empties the page as the music goes by, and *where* it
empties is the setting. Once you have played them tidies up behind you and
demands nothing. Moved forward, it stops being tidying: at *as I reach them*
the note under your fingers is already gone, so it can only be played if it
was read a step earlier, and one step further makes that two.

Gone means gone, not faint. A notehead's *position* is the whole of what it
says, and a ghost at a tenth of an opacity still says it plainly — reading a
pale note off its line is no harder than reading a black one, so anything
short of invisible makes the demanding settings a pretence. The staff, the
bar lines and the spacing stay, so the page empties without shifting under
the eye.

A note leaves with everything the engraver drew for it — its stem, its ledger
lines, and the beams joining it to its neighbours. Beams are the awkward part,
because a beam belongs to a *group* rather than to one note: it goes when the
last note under it goes, since a beam that left with the note it starts on
would strand the ones it is still holding together. VexFlow's own ids are what
link them (`vf-auto1003`, `vf-auto1003-stem`, `vf-auto1003-beam0`).

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

### Turning the page, and starting over

A page turn is the hardest moment in sight reading: the music you need next is
on a page you cannot see, and turning it is when you can least afford to look
away. So the page turns **in halves** - once the music reaches the last system,
the top of the next page is drawn where the first system used to be, closed
with a dashed edge so it reads as a piece of somewhere else. It is a clone of
the page ahead at the same size, so the notes stand where they will stand when
the page does turn, and it appears only while there is music moving: nothing is
about to turn when nothing is playing.

How the pages turn is one question with three answers, since the turning
itself was never something a reader could decline: turn them and show the next
page early, turn them quietly, or leave them to me. The last is for a piece
already learned, where looking up to find that the page has turned itself is
worse than not looking up at all - two arrows appear against the right edge,
with the page numbers between them, and the arrow keys go on working at a
desk. Everything else that turns a page is a reader asking for one, so only
the music is stopped from doing it.

**Quick replay** is stop and start in one press, and it is the only button in
the row whose home is a run - between runs the thing that begins one is Start.
Rewind is left where it is: that puts the *place* back to the top and belongs
between runs.

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

The relay stamps each press with the moment the key went down and the page
corrects for the difference between the two clocks, measured rather than
assumed - a desktop whose clock has drifted otherwise hands over every press
wrong by the same amount, with nothing to show for it. What cannot be
corrected is a hop that varies, and that is what a player feels, so the bridge
pill says it: `Bridge: Casio · ±37 ms` is a connection worth fixing before
blaming the keyboard. It says nothing while the hop is steady. The relay's
sockets are told not to wait for a second packet before sending the first,
which is the difference between a note and a file.

The space bar starts, pauses and resumes, so a run can be driven without
reaching for the mouse. It steps aside whenever a control has focus, since
that is how buttons and checkboxes are worked.

**There is one layout**, and it is the reading one: the score fills the screen
and a pill of controls sits at the bottom. It used to be a mode, with a desk
layout of toolbars and a side panel to arrive from — and two layouts meant
every control had two homes, every change had to be made twice, and the reader
was only ever in one of them.

Nothing asks the browser for real fullscreen. On a tablet that brings a
swipe-down gesture and a floating close button no page can turn off; it leaves
the moment an on-screen keyboard opens, which is what tapping a bar number
does, and it leaves again if a scroll runs past the top of the page. Every one
of those dropped the reader out mid-practice. Installed to a Home Screen there
is no browser chrome anyway, which is the way to get the last of the screen
back.

### Reading the rhythm off the page

A **ruler** can be drawn through the bars: a line at every half, quarter,
eighth, sixteenth or thirty-second, in three weights - the bar beginning, a
beat falling, a beat divided - so that where the beats are is *seen* rather
than worked out from the note values. It is drawn behind the notation, since a
grid that hides a notehead is worse than no grid, and its strength is one
number the reader turns down as far as invisible.

For that to be worth drawing, the page has to be spaced by *time*, and an
engraver does not space it that way: a long note gets less room than its length
asks for. Measured on a bar of half, quarter, quarter, where time says the half
should take twice the quarter's width, this engraver gives it 1.55 - and that
number does not move for `spacingFactorSoftmax`, for `SoftmaxFactorVexFlow`, or
for the `NoteDistances` table.

So the score handed to the engraver is padded with **rests nobody sees**, at
the finest grid every note of that bar lands on. The file on disk is never
touched - the printed MusicXML has always been derived from the exercise, and
this is one more thing derived into it. With them the same bar comes out at
2.00, exactly. They cost nothing anyone can see, the engraver drawing a hidden
note fully transparent, and nothing at all to the marker: its cursor steps
straight over them, so the timeline and the cursor go on agreeing about every
position in the piece. A coarser grid buys nothing - a half-note grid under a
bar of quarters changes not one pixel - and the whole of it costs a long score
about two seconds more to engrave, which is why the page says it is being
drawn while it draws.

A second **marker can run along the ruler**, beat by beat. It is not the marker
on the notes and could not be: that one stands where the music is written, and
under a held note it stands still while the beats go on passing - which is
exactly the stretch a reader loses count in.

### Playing against something

**The other hand can be heard** while you read yours. Practising one hand
against silence is practising something the piece never asks for: the part only
means what it means against the other one. It is not a second performance - the
same pulse and the same cursor cannot serve two masters - but the step itself,
sounded as the music reaches it, under the reader's own playing rather than
beside it.

**The click can follow the reader** instead of counting at them. In a mode that
waits there is no pulse, so asking for a click used to start one, which is a
machine counting on through music that is standing still. Told to keep time
*with* them, the beat they play is clicked where they put it and the beats
between their entries are placed where they are written and go on without them
- the same rule the other hand follows, so the two can never disagree about
where a beat is. It stops at the beat they come in on: that one is theirs to
place, and sounding it early would be the machine playing their part.

Both are reckoned from the moment the **key went down** rather than from the
moment the page heard about it, which over the relay is a hop apart - anchored
on the hearing, everything after a press came out that much late.

### The marker, and when it says something

Whether the marker is drawn is three questions, not one: while you play, while
the machine plays it back, and while nothing is running - a reader may want no
marker at all under their own hands and still want one following a playback,
and the third answer is how they see where they stopped.

Where a run keeps failing at one step, the marker **reddens** - once for each
wrong note played there, and back to itself when the music moves on. It comes
back even for a reader who put it away, and only for as long as there is
something to say: practising with every colour turned off is reading blind on
purpose, but blind you cannot tell *where* it went wrong, only that it did.

### Whether you practised today

The corner of the page says how long this has been open today, and seven marks
under it say which of the last seven days were practised, with the run of them
in words where there is a run to speak of. It is wall-clock time with the page
actually in front of you - ten minutes in another app is not ten minutes of
practice - and it is written down, so a reload, a closed tab or coming back
after supper carries on the same number.

Deliberately not the question the rest reminder asks. That one counts *notes*,
because hands are what a rest is for; this one counts sitting down, because a
reader who spent twenty minutes reading a page without playing it has
practised. A day counts once it has a minute on it: a run of days that a
glance can extend is a run worth nothing.

### Learning a piece rather than reading it

Three things exist for music you mean to keep rather than to sight-read.

**The plan** takes the piece apart the way a teacher would set it: each
section slowly with one hand, then the other, then both; then the sections
glued together, doubling, until the whole thing holds. Almost none of it is
new machinery, and that is the point - a section is the passage this trainer
has always had, a hand is the hand, a slow tempo is the percentage. What was
missing was the thing that puts them in order and knows when one is done. A
task is passed by a reading that reached the end and scored 95; short of that
the same task comes round again.

**One wrong note ends the run**, for when the point is counting a rhythm
rather than getting through: a slip that can be played over is worth nothing
to count against. It does not start the run again by itself.

**Survival** now runs in the waiting mode as well as under the pulse, and by a
different clock in each. Under a pulse the bar falls with the beats, so a slow
piece is no harder than a fast one. Where the music waits, it falls with the
seconds and every beat found fills it outright: room to think, and a reason
not to sit in one place.

### Being reminded to stop

Long practice is how hands are hurt, and this program knows something no clock
does: when you are actually playing. It counts the notes rather than the wall,
so a page left open over lunch is not an hour of practice, and a silence long
enough to be a break is not counted - while the thinking between two notes is,
the hands being on the keys throughout.

A rest falls **due** on that clock and is **said** at the first moment nothing
is going. A reminder that interrupts a run is one to be resented and then
turned off, so a run reaches its end, a performance finishes, and a repeat will
not come round again over a rest that is owed. Put off, it keeps the hour
already played rather than starting it over; taken, a ring counts three minutes
down and two notes say when they are up.

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
│   │   ├── Duration.ts             #   interned rhythmic values incl. tuplets, 3360/quarter
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
- `toleranceMs: Infinity` disables that rule, and the session hands it to every
  step of a mode that keeps no time and to any chord the writer marked to be
  rolled. The window asks whether two notes were struck *together*, which is a
  question about time: in Wait mode nothing is timing the reader, and a chord
  being learned is taken slowly - held to 250 ms, the second note restarted the
  attempt and forgot the first, so a chord found one note at a time could never
  be completed at all;
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
`MusicXmlParser` lists the cases. Every part of the score is read, one staff
after another - an exporter may write a piano's two hands as two parts of one
staff each, and reading only the first of those is reading only one hand.
Several voices on a staff are kept as several parts sharing a staff number, so a held note under a moving line stays a held
note; a voice absent from a bar is left out of it rather than resting through
it, and one that only comes in partway through a bar, or leaves before the end
of one, is silent for the remainder rather than resting through that either -
a rest is an instruction the writer gave, and inventing one asks the reader to
count something nobody wrote. What that may never do is leave the staff itself
blank, so the bars are checked across all their voices at once and a rest is
given back wherever nothing at all would be drawn. Key, metre, tempo and clef changes, stem directions and beaming are all
followed as written, along with rolled chords and the damper pedal. A metre
change moves the bar lines, so bars stop being all the same length and every
answer about musical position is read off `barLines` rather than worked out by
multiplying - the metronome included, which is handed those bars and accents
the downbeat the page draws rather than the one the opening metre would have
put there. A tempo change does the same to the clock: an accelerando is a run
of marks a sixteenth apart, so they are placed to the division and every answer
about *time* is walked over `tempoSpans` instead. The reader's tempo control is
a share of the written speed, so the changes move with it and keep their
proportions. A repeat is written out in the order it is read rather than jumped back to,
with each re-read bar keeping the number it has in the score - everything
drawn for the reader moves forward, and two readings of one printed page would
have to share the marker, the page turns, the veil and the marks. First and
second endings are followed. Grace notes are read as ornaments: drawn where
they were written, costing the bar nothing, and offered rather than demanded -
playing one is never a wrong note and leaving it out is never a missing one.
Written values are read down to sixty-fourths, with tuplets up to septuplets:
a file that divides a beat into sevens rounds its own numbers to fit its
divisions, and the written value is trusted over the rounding. Compressed
`.mxl` files are unpacked on the way in, since that is what MuseScore hands
you unless you ask otherwise.

## Known limits and next steps

- *Generated* rhythms stop at sixteenth notes, one dot and triplets; no
  pickup bars. An imported score may go shorter and use other tuplets.
  Sixteenths arrive in beamed pairs and triplets in complete threes, never
  singly and never straddling a beat.
- Values may cross a beat under the `syncopated` level, split at the boundary
  and tied. Everything else stays inside its beat, which is what keeps the
  other levels readable.
- Generated music is deliberately simple — diatonic, no accidentals outside the
  key — though the notation layer already handles accidentals correctly.
- How a reading went is kept per practice setting, which is what the ladder
  moves on, but there is no history to look back over yet - no list of the
  last runs and nothing to beat. Because every exercise is reproducible from
  its seed, "practise that one again" is a small feature away.
- Ruling the bars costs about two seconds more to engrave on a long score,
  since room is made in every bar of it. It is paid when the ruling changes
  and when a piece is opened, not while playing.
- The plan is a plan and nothing more: it says what to play next and waits for
  you to press Start, and it does not remember where it had got to if the page
  is closed. Neither is hard to add; both are decisions about how much the
  program should do for a reader who has not asked.

## Licence

MIT.

The bundled piano is not ours to license. The recordings in
`public/samples/piano/` are a reduction of the **Salamander Grand Piano V3**
by **Alexander Holm** — a Yamaha C5 sampled at sixteen velocity layers —
published under [Creative Commons Attribution
3.0](http://creativecommons.org/licenses/by/3.0/), and taken here from the
subset [Tone.js publishes](https://tonejs.github.io/audio/salamander). The
original library is at
<https://archive.org/details/SalamanderGrandPianoV3>.

Attribution is a condition of that licence, so it belongs where the licence
is stated rather than only beside the files. What was cut down and how is in
`public/samples/piano/CREDITS.md`, next to the recordings themselves.
