const MODULE_ID = "live-transcript";
const SOCKET_NAME = `module.${MODULE_ID}`;
const RAW_JOURNAL_NAME = "Live Transcript Raw";

const state = {
  eventSource: null,
  stream: null,
  recorder: null,
  recognition: null,
  segmentTimer: null,
  speechRestartTimer: null,
  sendQueue: [],
  running: false,
  sending: false,
  seq: 0,
  mimeType: "",
  browserSessionId: "",
  lines: [],
  raw: {
    sessionId: "",
    startedAt: null,
    engine: "",
    language: "",
    journalEntry: null,
    journalPage: null,
    text: "",
    lineCount: 0,
    saving: false,
    pending: false,
    failed: false
  },
  root: null
};

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  buildOverlay();
  game.socket.on(SOCKET_NAME, onSocketEvent);
  globalThis.LiveTranscript = {
    start,
    stop,
    toggle,
    connect: connectEvents,
    selectedText: selectedTranscriptText,
    recentText: recentTranscriptText,
    contextText: transcriptContextText,
    rawText: () => state.raw.text,
    flushRawTranscript: flushRawTranscriptSave,
    resetPosition: resetOverlayPosition,
    state
  };
  window.addEventListener("resize", keepOverlayInViewport);
});

function registerSettings() {
  game.settings.register(MODULE_ID, "serviceUrl", {
    name: "Service URL",
    hint: "Advanced. Used only when Engine is Local Service. Usually http://127.0.0.1:8798.",
    scope: "client",
    config: true,
    type: String,
    default: "http://127.0.0.1:8798"
  });

  game.settings.register(MODULE_ID, "engine", {
    name: "Engine",
    hint: "Choose browser recognition for low-latency captions, or use a compatible local transcription service.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      "browser-webspeech": "Browser Web Speech",
      service: "Local Service"
    },
    default: "browser-webspeech"
  });

  game.settings.register(MODULE_ID, "serviceEngine", {
    name: "Service engine",
    hint: "Advanced. Engine name sent to the service when Engine is Local Service.",
    scope: "client",
    config: true,
    type: String,
    default: "default"
  });

  game.settings.register(MODULE_ID, "language", {
    name: "Language",
    hint: "Speech recognition language.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      "browser-default": "Browser Default",
      "en-US": "English (US)",
      "en-GB": "English (UK)",
      "ru-RU": "Russian",
      "de-DE": "German",
      "fr-FR": "French",
      "es-ES": "Spanish",
      "it-IT": "Italian",
      "pt-BR": "Portuguese (Brazil)",
      "pl-PL": "Polish",
      "uk-UA": "Ukrainian",
      "ja-JP": "Japanese",
      "ko-KR": "Korean",
      "zh-CN": "Chinese (Simplified)",
      "custom": "Custom"
    },
    default: "browser-default"
  });

  game.settings.register(MODULE_ID, "customLanguage", {
    name: "Custom language",
    hint: "BCP 47 language tag used when Language is Custom, for example nl-NL or pt-PT.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "prompt", {
    name: "Phrase hints",
    hint: "Campaign terms passed to engines that support contextual hints.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "segmentMs", {
    name: "Segment length",
    hint: "Local Service only. Audio segment length in milliseconds. Shorter is faster, longer is usually more accurate.",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 2000, max: 15000, step: 1000 },
    default: 3000
  });

  game.settings.register(MODULE_ID, "overlayCustomPosition", {
    name: "Overlay custom position",
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "overlayPosition", {
    name: "Overlay position",
    hint: "Screen position for the live transcript overlay.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      "left-center": "Left center",
      "top-center": "Top center",
      "top-right": "Top right",
      "bottom-center": "Bottom center"
    },
    default: "left-center",
    onChange: () => {
      void game.settings.set(MODULE_ID, "overlayCustomPosition", "").then(applyOverlayPosition);
    }
  });

  game.settings.register(MODULE_ID, "broadcastToPlayers", {
    name: "Broadcast to players",
    hint: "Show final GM transcript lines to connected players through Foundry sockets.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true
  });

  game.settings.register(MODULE_ID, "postToChat", {
    name: "Post to GM chat",
    hint: "Also copy final transcript lines to the chat log as GM-only whispers.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "saveRawTranscript", {
    name: "Save raw transcript",
    hint: "Persist final GM transcript lines to a GM-only Journal for post-session summaries.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true
  });
}

function buildOverlay() {
  if (state.root) return;
  const root = document.createElement("div");
  root.id = "live-transcript";
  root.innerHTML = `
    <div class="lt-panel">
      <div class="lt-head" data-lt-drag title="Drag to move">
        <span class="lt-dot" data-lt-dot></span>
        <span class="lt-status" data-lt-status>transcript idle</span>
        ${game.user.isGM ? `
          <div class="lt-controls">
            <button type="button" data-lt-start>Start</button>
            <button type="button" data-lt-stop disabled>Stop</button>
            <button type="button" data-lt-copy>Copy</button>
          </div>
        ` : ""}
      </div>
      <div class="lt-text" data-lt-text></div>
      ${game.user.isGM ? `<textarea class="lt-log" data-lt-log spellcheck="true" aria-label="Live transcript log"></textarea>` : ""}
    </div>
  `;
  document.body.appendChild(root);
  state.root = root;
  applyOverlayPosition();

  root.querySelector("[data-lt-start]")?.addEventListener("click", start);
  root.querySelector("[data-lt-stop]")?.addEventListener("click", stop);
  root.querySelector("[data-lt-copy]")?.addEventListener("click", copyTranscript);
  root.querySelector("[data-lt-drag]")?.addEventListener("pointerdown", beginOverlayDrag);
}

function applyOverlayPosition() {
  if (!state.root) return;
  const custom = overlayCustomPosition();
  if (custom) {
    state.root.dataset.position = "custom";
    setOverlayPixels(custom.left, custom.top);
    return;
  }

  state.root.style.left = "";
  state.root.style.top = "";
  state.root.style.right = "";
  state.root.style.bottom = "";
  state.root.style.transform = "";
  state.root.dataset.position = game.settings.get(MODULE_ID, "overlayPosition") || "left-center";
}

function overlayCustomPosition() {
  const raw = String(game.settings.get(MODULE_ID, "overlayCustomPosition") || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clampOverlayPosition(left, top) {
  const rect = state.root?.getBoundingClientRect();
  const width = rect?.width || 320;
  const height = rect?.height || 120;
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop)
  };
}

function setOverlayPixels(left, top) {
  const pos = clampOverlayPosition(left, top);
  state.root.style.left = `${Math.round(pos.left)}px`;
  state.root.style.top = `${Math.round(pos.top)}px`;
  state.root.style.right = "auto";
  state.root.style.bottom = "auto";
  state.root.style.transform = "none";
}

async function saveOverlayPosition(left, top) {
  const pos = clampOverlayPosition(left, top);
  await game.settings.set(MODULE_ID, "overlayCustomPosition", JSON.stringify({
    left: Math.round(pos.left),
    top: Math.round(pos.top)
  }));
}

async function resetOverlayPosition() {
  await game.settings.set(MODULE_ID, "overlayCustomPosition", "");
  applyOverlayPosition();
}

function keepOverlayInViewport() {
  if (!state.root || state.root.dataset.position !== "custom") return;
  const rect = state.root.getBoundingClientRect();
  const pos = clampOverlayPosition(rect.left, rect.top);
  setOverlayPixels(pos.left, pos.top);
  void saveOverlayPosition(pos.left, pos.top);
}

function beginOverlayDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest("button, input, textarea, select, a")) return;

  const rect = state.root.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  state.root.dataset.position = "custom";
  state.root.dataset.dragging = "true";
  setOverlayPixels(rect.left, rect.top);
  event.preventDefault();

  const onMove = moveEvent => {
    setOverlayPixels(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    delete state.root.dataset.dragging;
    const next = state.root.getBoundingClientRect();
    void saveOverlayPosition(next.left, next.top);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

function serviceUrl() {
  return String(game.settings.get(MODULE_ID, "serviceUrl") || "").replace(/\/+$/, "");
}

function engineName() {
  return String(game.settings.get(MODULE_ID, "engine") || "").trim().toLowerCase();
}

function isBrowserSpeechEngine(engine = engineName()) {
  return engine === "browser-webspeech" || engine === "webspeech" || engine === "browser";
}

function serviceEngineName(engine = engineName()) {
  if (engine && !["browser-webspeech", "webspeech", "browser", "service", "local-service"].includes(engine)) {
    return engine;
  }
  return String(game.settings.get(MODULE_ID, "serviceEngine") || "default").trim() || "default";
}

function browserLanguage() {
  return String(globalThis.navigator?.language || "").trim() || "en-US";
}

function languageHint() {
  const language = String(game.settings.get(MODULE_ID, "language") || "browser-default").trim();
  if (!language || language === "browser-default") return browserLanguage();
  if (language === "custom") {
    return String(game.settings.get(MODULE_ID, "customLanguage") || "").trim() || browserLanguage();
  }
  return language;
}

function setStatus(text, level = "idle") {
  const status = state.root?.querySelector("[data-lt-status]");
  const dot = state.root?.querySelector("[data-lt-dot]");
  if (status) status.textContent = text;
  if (dot) dot.dataset.level = level;
}

function setControls() {
  const startButton = state.root?.querySelector("[data-lt-start]");
  const stopButton = state.root?.querySelector("[data-lt-stop]");
  if (startButton) startButton.disabled = state.running;
  if (stopButton) stopButton.disabled = !state.running;
}

function setTranscript(text, quiet = false) {
  const el = state.root?.querySelector("[data-lt-text]");
  if (!el) return;
  el.textContent = text || "";
  state.root.classList.toggle("lt-has-text", Boolean(text));
  if (!quiet && text) window.setTimeout(() => {
    if (!state.running) state.root?.classList.remove("lt-has-text");
  }, 12000);
}

function appendTranscriptLine(event) {
  const text = String(event.text || "").trim();
  if (!text) return;
  const ts = new Date(event.ts || Date.now());
  const stamp = Number.isNaN(ts.getTime())
    ? ""
    : ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  state.lines.push({
    seq: event.seq,
    text,
    stamp,
    engine: event.engine || ""
  });
  if (state.lines.length > 250) state.lines.splice(0, state.lines.length - 250);
  void appendRawTranscriptLine(event, text, stamp);
  appendLogText(text);
}

function beginRawTranscriptSession({ sessionId = "", engine = "", language = "" } = {}) {
  if (!game.user.isGM) return;
  state.raw.sessionId = sessionId || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  state.raw.startedAt = new Date();
  state.raw.engine = engine || "";
  state.raw.language = language || "";
  state.raw.journalEntry = null;
  state.raw.journalPage = null;
  state.raw.text = "";
  state.raw.lineCount = 0;
  state.raw.saving = false;
  state.raw.pending = false;
  state.raw.failed = false;
}

function ensureRawTranscriptSession(event = {}) {
  if (state.raw.startedAt) return;
  beginRawTranscriptSession({
    sessionId: event.session_id || state.browserSessionId,
    engine: event.engine || engineName(),
    language: event.meta?.language || languageHint()
  });
}

async function appendRawTranscriptLine(event, text, stamp) {
  if (!game.user.isGM || !game.settings.get(MODULE_ID, "saveRawTranscript")) return;
  ensureRawTranscriptSession(event);
  const scene = canvas?.scene?.name || "";
  const parts = [stamp || rawClock(event.ts)];
  if (scene) parts.push(scene);
  if (event.engine) parts.push(event.engine);
  state.raw.text += `[${parts.join(" | ")}] ${text}\n`;
  state.raw.lineCount += 1;
  queueRawTranscriptSave();
}

function queueRawTranscriptSave() {
  state.raw.pending = true;
  if (!state.raw.saving) void drainRawTranscriptSave();
}

async function drainRawTranscriptSave() {
  state.raw.saving = true;
  try {
    while (state.raw.pending) {
      state.raw.pending = false;
      await saveRawTranscriptNow();
    }
  } catch (error) {
    console.error(`${MODULE_ID} raw transcript save failed`, error);
    if (!state.raw.failed) {
      state.raw.failed = true;
      ui.notifications.error(`Raw transcript save failed: ${error.message || error}`);
    }
  } finally {
    state.raw.saving = false;
    if (state.raw.pending) void drainRawTranscriptSave();
  }
}

async function flushRawTranscriptSave() {
  while (state.raw.saving) await wait(25);
  if (state.raw.pending) await drainRawTranscriptSave();
}

async function saveRawTranscriptNow() {
  if (!state.raw.text.trim()) return;
  const page = await ensureRawTranscriptPage();
  await page.update({ "text.content": rawTranscriptHTML() });
}

async function ensureRawTranscriptPage() {
  if (state.raw.journalPage) return state.raw.journalPage;

  let entry = state.raw.journalEntry || game.journal.getName(RAW_JOURNAL_NAME);
  if (!entry) {
    entry = await JournalEntry.create({
      name: RAW_JOURNAL_NAME,
      ownership: { default: 0, [game.user.id]: 3 }
    });
  }
  state.raw.journalEntry = entry;

  const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
    name: rawTranscriptPageName(),
    type: "text",
    text: {
      content: rawTranscriptHTML(),
      format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1
    }
  }]);
  state.raw.journalPage = page;
  return page;
}

function rawTranscriptPageName() {
  const started = state.raw.startedAt || new Date();
  const date = rawDateTime(started).replace(":", ".");
  const scene = canvas?.scene?.name ? ` - ${canvas.scene.name}` : "";
  return `${date}${scene}`.slice(0, 90);
}

function rawTranscriptHTML() {
  const started = state.raw.startedAt || new Date();
  const scene = canvas?.scene?.name || "";
  const meta = [
    ["Started", rawDateTime(started)],
    ["World", game.world?.title || game.world?.id || ""],
    ["Scene", scene],
    ["GM", game.user?.name || ""],
    ["Engine", state.raw.engine],
    ["Language", state.raw.language],
    ["Session", state.raw.sessionId],
    ["Lines", String(state.raw.lineCount)]
  ].filter(([, value]) => value);
  const list = meta.map(([label, value]) => `<li><strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}</li>`).join("");
  return [
    `<h1>Live Transcript ${escapeHTML(rawDateTime(started))}</h1>`,
    `<ul>${list}</ul>`,
    "<h2>Raw Transcript</h2>",
    `<pre>${escapeHTML(state.raw.text.trimEnd())}</pre>`
  ].join("");
}

function rawClock(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function rawDateTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function renderTranscriptLog() {
  const log = state.root?.querySelector("[data-lt-log]");
  if (!log) return;
  log.value = state.lines.map(line => line.text).join("\n");
  log.scrollTop = log.scrollHeight;
}

function appendLogText(text) {
  const log = state.root?.querySelector("[data-lt-log]");
  if (!log) return;
  const clean = String(text || "").trim();
  if (!clean) return;
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  const prefix = log.value.trim() ? "\n" : "";
  log.value = `${log.value}${prefix}${clean}`;
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function logText() {
  const log = state.root?.querySelector("[data-lt-log]");
  return String(log?.value || "").trim();
}

function selectedTranscriptText() {
  const log = state.root?.querySelector("[data-lt-log]");
  if (!log) return "";
  if (log.selectionStart != null && log.selectionEnd != null && log.selectionEnd > log.selectionStart) {
    return log.value.slice(log.selectionStart, log.selectionEnd).trim();
  }
  return "";
}

function recentTranscriptText() {
  const text = logText();
  if (!text) return "";
  return text.split("\n").map(line => line.trim()).filter(Boolean).slice(-8).join("\n").trim();
}

function transcriptContextText() {
  return selectedTranscriptText() || recentTranscriptText();
}

async function copyTranscript() {
  const text = transcriptContextText();
  if (!text) return ui.notifications.warn("Transcript is empty.");
  try {
    await navigator.clipboard.writeText(text);
    ui.notifications.info(selectedTranscriptText() ? "Selected transcript copied." : "Recent transcript copied.");
  } catch (error) {
    console.error(`${MODULE_ID} copy failed`, error);
    ui.notifications.error(`Copy failed: ${error.message || error}`);
  }
}

async function toggle() {
  return state.running ? stop() : start();
}

async function start() {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can start transcription.");
  if (state.running) return;

  try {
    if (isBrowserSpeechEngine()) {
      startBrowserSpeech();
      return;
    }

    setStatus("connecting service", "pending");
    setControls();
    connectEvents();

    const engine = engineName();
    const body = {
      engine: serviceEngineName(engine),
      language: languageHint(),
      prompt: game.settings.get(MODULE_ID, "prompt")
    };
    const response = await fetch(`${serviceUrl()}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await response.text());

    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    state.running = true;
    state.seq = 0;
    state.lines = [];
    beginRawTranscriptSession({
      engine: body.engine,
      language: body.language
    });
    renderTranscriptLog();
    state.mimeType = chooseMimeType();
    setStatus("listening", "active");
    setControls();
    recordNextSegment();
  } catch (error) {
    console.error(`${MODULE_ID} start failed`, error);
    state.running = false;
    await cleanupCapture();
    setStatus("start failed", "error");
    ui.notifications.error(`Transcription failed to start: ${error.message || error}`);
    setControls();
  }
}

async function stop() {
  if (!game.user.isGM) return;
  if (state.recognition || isBrowserSpeechEngine()) {
    stopBrowserSpeech();
    return;
  }

  state.running = false;
  setStatus("stopping", "pending");
  setControls();

  if (state.segmentTimer) {
    window.clearTimeout(state.segmentTimer);
    state.segmentTimer = null;
  }
  if (state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  }
  await cleanupCapture();

  try {
    await fetch(`${serviceUrl()}/session/stop`, { method: "POST" });
  } catch (error) {
    console.warn(`${MODULE_ID} stop request failed`, error);
  }
  await flushRawTranscriptSave();
  setStatus("stopped", "idle");
  setControls();
}

function speechRecognitionClass() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

function speechLanguage() {
  const language = languageHint();
  const normalized = language.toLowerCase();
  if (normalized === "ru") return "ru-RU";
  if (normalized === "en") return "en-US";
  return language || browserLanguage();
}

function startBrowserSpeech() {
  const Recognition = speechRecognitionClass();
  if (!Recognition) {
    throw new Error("Browser SpeechRecognition is not available. Use Chrome or Edge.");
  }

  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  if (state.speechRestartTimer) {
    window.clearTimeout(state.speechRestartTimer);
    state.speechRestartTimer = null;
  }

  const recognition = new Recognition();
  const sessionId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  recognition.lang = speechLanguage();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.addEventListener("start", () => {
    setStatus(`browser speech ${recognition.lang}`, "active");
  });

  recognition.addEventListener("result", event => {
    const interim = [];
    const finals = [];
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = String(result[0]?.transcript || "").trim();
      if (!text) continue;
      if (result.isFinal) finals.push(text);
      else interim.push(text);
    }

    if (interim.length) {
      setTranscript(interim.join(" "), true);
      setStatus("browser speech live", "active");
    }
    if (finals.length) emitBrowserTranscript(finals.join(" "), recognition.lang);
  });

  recognition.addEventListener("error", event => {
    const error = event.error || "unknown";
    console.error(`${MODULE_ID} browser speech error`, event);
    setStatus(`speech ${error}`, "error");
    if (["not-allowed", "service-not-allowed", "language-not-supported"].includes(error)) {
      state.running = false;
      state.recognition = null;
      setControls();
    }
  });

  recognition.addEventListener("end", () => {
    if (!state.running || state.recognition !== recognition) return;
    setStatus("browser speech reconnecting", "pending");
    state.speechRestartTimer = window.setTimeout(() => {
      if (!state.running || state.recognition !== recognition) return;
      try {
        recognition.start();
      } catch (error) {
        console.warn(`${MODULE_ID} browser speech restart failed`, error);
      }
    }, 250);
  });

  state.recognition = recognition;
  state.browserSessionId = sessionId;
  state.running = true;
  state.seq = 0;
  state.sendQueue = [];
  state.lines = [];
  beginRawTranscriptSession({
    sessionId,
    engine: "browser-webspeech",
    language: recognition.lang
  });
  renderTranscriptLog();
  setTranscript("", true);
  setStatus("starting browser speech", "pending");
  setControls();
  try {
    recognition.start();
  } catch (error) {
    state.running = false;
    state.recognition = null;
    setControls();
    throw error;
  }
}

function stopBrowserSpeech() {
  state.running = false;
  setStatus("stopping", "pending");
  setControls();

  if (state.speechRestartTimer) {
    window.clearTimeout(state.speechRestartTimer);
    state.speechRestartTimer = null;
  }

  const recognition = state.recognition;
  state.recognition = null;
  if (recognition) {
    try {
      recognition.stop();
    } catch (error) {
      console.warn(`${MODULE_ID} browser speech stop failed`, error);
    }
  }
  cleanupCapture();

  broadcast({
    type: "session.stopped",
    session: {
      id: state.browserSessionId,
      engine: "browser-webspeech",
      active: false
    }
  });
  void flushRawTranscriptSave();
  setStatus("stopped", "idle");
  setControls();
}

function emitBrowserTranscript(text, language) {
  const clean = String(text || "").trim();
  if (!clean) return;
  const event = {
    type: "transcript.final",
    session_id: state.browserSessionId,
    seq: ++state.seq,
    engine: "browser-webspeech",
    text: clean,
    meta: {
      source: "browser-speech-recognition",
      language
    },
    ts: new Date().toISOString()
  };
  handleTranscript(event);
  broadcast(event);
}

function chooseMimeType() {
  if (!globalThis.MediaRecorder) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function recordNextSegment() {
  if (!state.running || !state.stream) return;
  const chunks = [];
  const options = state.mimeType ? { mimeType: state.mimeType } : undefined;
  const recorder = new MediaRecorder(state.stream, options);
  state.recorder = recorder;

  recorder.addEventListener("dataavailable", event => {
    if (event.data?.size) chunks.push(event.data);
  });
  recorder.addEventListener("error", event => {
    console.error(`${MODULE_ID} recorder error`, event);
    setStatus("recorder error", "error");
  });
  recorder.addEventListener("stop", async () => {
    if (!state.running) return;
    const type = state.mimeType || chunks[0]?.type || "application/octet-stream";
    const blob = new Blob(chunks, { type });
    if (state.running) window.setTimeout(recordNextSegment, 25);
    if (blob.size) enqueueSegment(blob, ++state.seq);
  });

  recorder.start();
  state.segmentTimer = window.setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, Number(game.settings.get(MODULE_ID, "segmentMs")) || 3000);
}

function enqueueSegment(blob, seq) {
  state.sendQueue.push({ blob, seq, queuedAt: Date.now() });
  void drainSendQueue();
}

async function drainSendQueue() {
  if (state.sending) return;
  state.sending = true;
  try {
    while (state.sendQueue.length) {
      const item = state.sendQueue.shift();
      await sendSegment(item.blob, item.seq, item.queuedAt);
    }
  } catch (error) {
    console.error(`${MODULE_ID} segment queue failed`, error);
  } finally {
    state.sending = false;
    if (state.sendQueue.length) void drainSendQueue();
  }
}

async function sendSegment(blob, seq, queuedAt) {
  try {
    const url = `${serviceUrl()}/segment?seq=${seq}&mime=${encodeURIComponent(blob.type || "")}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob
    });
    if (!response.ok) throw new Error(await response.text());
    const elapsed = ((Date.now() - queuedAt) / 1000).toFixed(1);
    setStatus(`listening, ${state.sendQueue.length} queued, last ${elapsed}s`, "active");
  } catch (error) {
    console.error(`${MODULE_ID} segment send failed`, error);
    setStatus("segment failed", "error");
  }
}

async function cleanupCapture() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
  }
  state.stream = null;
  state.recorder = null;
  state.sendQueue = [];
}

function connectEvents() {
  if (!game.user.isGM) return;
  if (state.eventSource) state.eventSource.close();
  const events = new EventSource(`${serviceUrl()}/events`);
  state.eventSource = events;

  for (const name of ["hello", "session.started", "session.stopped", "transcript.final", "error"]) {
    events.addEventListener(name, event => {
      const payload = JSON.parse(event.data);
      onServiceEvent(payload);
    });
  }
  events.onerror = () => {
    if (state.running) setStatus("service disconnected", "error");
  };
}

function onServiceEvent(event) {
  if (event.type === "hello") {
    setStatus(state.running ? "listening" : "service ready", state.running ? "active" : "idle");
    return;
  }
  if (event.type === "session.started") {
    setStatus("session started", "active");
    broadcast(event);
    return;
  }
  if (event.type === "session.stopped") {
    setStatus("session stopped", "idle");
    broadcast(event);
    return;
  }
  if (event.type === "error") {
    setStatus("service error", "error");
    if (event.error) setTranscript(event.error);
    broadcast(event);
    return;
  }
  if (event.type === "transcript.final") {
    handleTranscript(event);
    broadcast(event);
  }
}

function broadcast(event) {
  if (!game.user.isGM || !game.settings.get(MODULE_ID, "broadcastToPlayers")) return;
  game.socket.emit(SOCKET_NAME, {
    ...event,
    origin: game.user.id
  });
}

function onSocketEvent(event) {
  if (!event || event.origin === game.user.id) return;
  if (event.type === "transcript.final") handleTranscript(event);
  if (event.type === "session.stopped") setStatus("session stopped", "idle");
  if (event.type === "error" && event.error) {
    setStatus("service error", "error");
    setTranscript(event.error);
  }
}

function handleTranscript(event) {
  const text = String(event.text || "").trim();
  if (!text) return;
  if (game.user.isGM) appendTranscriptLine(event);
  setTranscript(text);
  setStatus(`caption #${event.seq ?? "?"}`, "active");
  if (game.user.isGM && game.settings.get(MODULE_ID, "postToChat")) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: "GM transcript" }),
      content: `<p class="lt-chat">${escapeHTML(text)}</p>`,
      whisper: [game.user.id]
    });
  }
}

function escapeHTML(text) {
  const node = document.createElement("div");
  node.textContent = text;
  return node.innerHTML;
}
