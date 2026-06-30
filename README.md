# Live Transcript

Live Transcript is a small Foundry VTT module for showing live GM speech captions in-game. It is intentionally limited to transcription, transcript editing/copying, player broadcast, and optional raw transcript journaling.

It does not include an AI assistant, prompt button, model router, or campaign-specific integration.

## Features

- GM-only microphone capture controls: `Start`, `Stop`, and `Copy`.
- Browser speech recognition mode for low-latency captions in Chrome/Edge.
- Optional local transcription service mode for external engines.
- Editable GM transcript text area.
- Optional broadcast of final transcript lines to players through Foundry sockets.
- Optional raw transcript Journal entry for post-session summaries.
- Draggable overlay with saved client-side position.

## Installation

Copy this module directory into your Foundry data modules folder:

```text
FoundryVTT/Data/modules/live-transcript/
```

Then enable `Live Transcript` from Foundry's module settings.

## Basic Setup

Recommended browser mode:

- `Engine`: `browser-webspeech`
- `Language`: defaults to the browser locale; set a speech locale such as `en-US`, `ru-RU`, or `de-DE` if needed.

Browser speech recognition requires a supported browser, practically Chrome or Edge. Depending on the browser, audio may be processed by the browser vendor's speech service.

## Local Service Mode

For external engines, set `Engine` to the service engine name and run a compatible service at `Service URL`, normally:

```text
http://127.0.0.1:8798
```

The service should expose `/events`, `/session/start`, `/segment`, and `/session/stop`.

## Raw Transcript Journal

When `Save raw transcript` is enabled, the GM client writes final ASR lines to a GM-owned Journal named `Live Transcript Raw`. Each recording session gets its own page with timestamps, scene name, engine, and raw text.

Manual edits in the overlay text area do not change the raw Journal transcript.

## License

MIT License. See `LICENSE` for details.
