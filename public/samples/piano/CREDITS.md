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
| Length | up to 25 s | 6 s |
| Channels | stereo | stereo |
| Total | 1.9 GB | 1.0 MB |

The trim is a stream copy: MP3 frames are cut, never re-encoded, so what is
here is bit-for-bit the audio that was published. The cut end is faded by the
player rather than being baked into the file.

The two semitones between recordings are covered by resampling, which is what
a hardware sampler does.

`tools/samples/fetch-piano-samples.mjs` performs this reduction and can be run
again with a different length, for example `--seconds 10`.
