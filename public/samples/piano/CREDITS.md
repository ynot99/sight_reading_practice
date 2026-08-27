# Piano samples

These recordings come from the **Salamander Grand Piano V3** by **Alexander
Holm**, a Yamaha C5 sampled at 16 velocity layers, published under the
[Creative Commons Attribution 3.0](http://creativecommons.org/licenses/by/3.0/)
licence.

- Source library: <https://archive.org/details/SalamanderGrandPianoV3> (1.9 GB)
- The subset here was taken from the copy Tone.js publishes at
  <https://tonejs.github.io/audio/salamander>

## What was changed

The original library cannot be sent to a browser, so this is a reduction of it:

| | Original | Here |
| --- | --- | --- |
| Velocity layers | 16 | 1 |
| Notes | every 3rd semitone | every 3rd semitone (30 files, A0–C8) |
| Length | up to 25 s | 5 s, with a 0.5 s fade |
| Channels | stereo | mono |
| Total | 1.9 GB | 1.7 MB |

The two semitones between recordings are covered by resampling, which is what
a hardware sampler does.

`tools/samples/fetch-piano-samples.mjs` performs this reduction and can be run
again with different settings, for example `--seconds 8 --stereo`.
