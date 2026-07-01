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

Most users do not need to install or run any server. Use the built-in browser mode first.

Recommended browser mode:

- `Engine`: `Browser Web Speech`
- `Language`: `Browser Default`, or choose a speech locale such as `English (US)`, `Russian`, or `German`.
- `Custom language`: optional BCP 47 tag such as `nl-NL` or `pt-PT` when `Language` is `Custom`.

Browser speech recognition requires a supported browser, practically Chrome or Edge. Depending on the browser, audio may be processed by the browser vendor's speech service.

The module must be opened from `localhost` or HTTPS for microphone access. If nothing happens after pressing `Start`, check the browser microphone permission first.

## Local Service Mode

Local Service mode is optional and advanced. It is useful only when you already have a compatible transcription bridge that can receive browser audio segments and send transcript events back to Foundry.

The module does not include a transcription server. To use one:

1. Install or run a compatible bridge on the GM computer.
2. Make sure the bridge listens at a URL the GM browser can reach.
3. In Foundry, set `Engine` to `Local Service`.
4. Set `Service URL`, normally:

```text
http://127.0.0.1:8798
```

5. Set `Service engine` to the engine name expected by that bridge.
6. Press `Start`.

Players do not need access to the service. The GM browser sends audio to the service, and Foundry sends final transcript lines to players through the module socket.

For online services, do not put provider API keys in Foundry settings. Use a small backend bridge with HTTPS and CORS enabled, then point `Service URL` at that bridge.

See [Service API](docs/service-api.md) for the bridge protocol.

## Raw Transcript Journal

When `Save raw transcript` is enabled, the GM client writes final ASR lines to a GM-owned Journal named `Live Transcript Raw`. Each recording session gets its own page with timestamps, scene name, engine, and raw text.

Manual edits in the overlay text area do not change the raw Journal transcript.

## License

MIT License. See `LICENSE` for details.
