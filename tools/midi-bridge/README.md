# MIDI bridge

Lets you practise on a tablet.

iPadOS has no Web MIDI API — not in Safari, and not in Chrome or Firefox
either, because every browser on iOS is Safari underneath. A tablet therefore
cannot see a MIDI keyboard at all, no matter what the page does.

So the keyboard goes into a computer instead. This script relays its notes over
the local network and serves the trainer at the same time, which turns the iPad
into a screen on the music stand:

```
  Casio ──USB──► this computer ──Wi-Fi──► iPad on the music stand
                 bridge.mjs               (just a browser tab)
```

The relay adds a millisecond or two on a home network. Timing is judged against
the beat on the tablet's own clock, so that delay never reaches your score.

## Setup, once

```bash
npm install            # in this folder
npm run build          # in the project root, to produce dist/
```

## Every time you practise

```bash
npm run bridge         # from the project root: builds, then starts the bridge
```

or, without rebuilding:

```bash
node tools/midi-bridge/bridge.mjs
```

It prints the address to open on the iPad, for example
`http://192.168.100.130:8080/`. Both devices must be on the same Wi-Fi.

**The first run will raise a Windows Firewall prompt.** Allow access on private
networks, otherwise the iPad cannot reach the computer.

## Options

| Flag | Meaning |
| --- | --- |
| `--list` | List the MIDI inputs this computer can see, then exit |
| `--device casio` | Use the input whose name contains this text, instead of the first |
| `--port 4000` | Serve on a different port |
| `--root ../../dist` | Serve a different build directory |

The keyboard may be plugged in, unplugged and switched on at any time: the
bridge checks every second and reconnects on its own, and so does the browser.

## Troubleshooting

**"No MIDI inputs found"** — switch the keyboard on before running `--list`.
On a Casio Privia, the USB port must be the one marked `USB TO HOST`.

**The iPad cannot open the address** — almost always the firewall prompt was
dismissed, or the two devices are on different networks (guest Wi-Fi, or the
phone's hotspot).

**Notes do not arrive** — the pill at the top of the page names the keyboard the
bridge is reading. If it says "no keyboard", the computer is not seeing it
either; check with `--list`.

**`require` fails after install** — npm may have skipped the package's install
script. Run `npm approve-scripts` in this folder and install again.

## Protocol

One-way JSON frames over a WebSocket at `/midi`:

```json
{"v":1,"type":"hello","device":"CASIO USB-MIDI"}
{"v":1,"type":"device","device":null}
{"v":1,"type":"noteon","note":60,"velocity":0.79}
{"v":1,"type":"noteoff","note":60}
{"v":1,"type":"pedal","down":true,"value":1}
{"v":1,"type":"control","controller":7,"value":0.62}
```

A `control` frame is any knob, slider or wheel other than the damper, sent by
the number it uses. The bridge decides nothing about what it means: which
control is a volume knob differs per keyboard, and the tablet is where the
reader teaches the app theirs — so it can only learn what reaches it.

No timestamps are sent, deliberately: the two computers' clocks share no
origin, so the browser stamps each note as it arrives and keeps every timing
comparison on a single clock.
