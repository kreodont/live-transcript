# Service API

Live Transcript works without a server when `Engine` is `Browser Web Speech`. A service is only needed for advanced setups that use a local or online transcription backend.

The Foundry module talks to a bridge service from the GM browser. The bridge can run on the GM computer, on the Foundry host, or online. It must be reachable from the GM browser.

## Local Bridge

Use a local bridge when you want to run your own speech-to-text engine on the GM computer.

1. Start the bridge locally, usually on `127.0.0.1:8798`.
2. In Foundry, open module settings for `Live Transcript`.
3. Set `Engine` to `Local Service`.
4. Set `Service URL` to `http://127.0.0.1:8798`.
5. Set `Service engine` to the engine name your bridge expects.
6. Press `Start` in the transcript overlay.

Only the GM browser needs to reach the local bridge. Players receive text through Foundry and do not connect to the bridge.

## Online Bridge

Use an online bridge when transcription runs on a hosted machine or calls an online speech-to-text provider.

1. Deploy a backend bridge with HTTPS.
2. Store provider API keys on the backend, never in Foundry settings.
3. Enable CORS for the Foundry origin, or allow all origins if appropriate for your deployment.
4. In Foundry, set `Engine` to `Local Service`.
5. Set `Service URL` to the bridge URL, for example `https://asr.example.com`.
6. Set `Service engine` to the backend engine name.

If Foundry is opened over HTTPS, the service should also use HTTPS to avoid browser security blocks.

## Required Endpoints

The bridge should expose these endpoints:

- `GET /events`
- `POST /session/start`
- `POST /segment?seq=<number>&mime=<mime-type>`
- `POST /session/stop`

Optional health endpoints such as `GET /health` or `GET /engines` are useful for debugging, but the module does not require them.

## Session Start

`POST /session/start` receives JSON:

```json
{
  "engine": "default",
  "language": "en-US",
  "prompt": "optional phrase hints"
}
```

Return a JSON response such as:

```json
{
  "ok": true,
  "session": {
    "id": "20260630-120000",
    "engine": "default",
    "language": "en-US",
    "active": true
  }
}
```

## Audio Segments

`POST /segment` receives the raw audio segment in the request body. The request includes:

- `seq`: segment number.
- `mime`: browser audio MIME type.
- `Content-Type`: same audio MIME type when available.

Common MIME types are `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`, and `audio/mp4`.

The response can be simple:

```json
{
  "ok": true
}
```

Final transcript text should be sent through the SSE stream.

## Server-Sent Events

`GET /events` must return `text/event-stream`. The module listens for these event names:

- `hello`
- `session.started`
- `session.stopped`
- `transcript.final`
- `error`

Every event should contain JSON in `data`.

Example final transcript event:

```text
event: transcript.final
data: {"type":"transcript.final","session_id":"20260630-120000","seq":1,"engine":"default","text":"The door opens.","meta":{"language":"en-US"}}
```

The important fields are:

- `type`: must be `transcript.final`.
- `text`: final text to show in Foundry.
- `seq`: segment number if available.
- `engine`: backend engine name if available.
- `meta`: optional extra details.

## Stop

`POST /session/stop` should stop the active session and may send a `session.stopped` SSE event.
