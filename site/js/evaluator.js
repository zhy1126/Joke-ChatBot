import {
  CONDITIONS,
  DEFAULT_CONFIG,
  auditJoke,
  conditionLabel,
  createSession,
  startSession,
  submitParticipantMessage,
} from "./core.js";
import { createRemoteApi, readRemoteSettings } from "./remote-api.js";

const PRESETS = Object.freeze({
  en: Object.freeze({
    work: "The March heading is inconsistent. I’ll change it to “March 2026.”",
    progress: "The March heading is changed now.",
    joke:
      "Why did the spreadsheet break up with the database? It had too many relationship problems.",
    closure: "Everything is done now. There is nothing else to handle.",
  }),
  "zh-CN": Object.freeze({
    work: "三月份的标题格式不一致，我会把它改成“2026年3月”。",
    progress: "三月份的标题已经修改好了。",
    joke: "为什么电子表格和数据库分手了？因为它们之间的关系问题太多了。",
    closure: "现在都完成了，没有其他需要处理的内容。",
  }),
});

let sessions = new Map();
let liveApi = null;
let liveToken = "";
let liveSession = null;
let liveCondition = "";

export function initializeEvaluator() {
  hide("researcher-view");
  hide("participant-view");
  show("evaluator-view");
  document.title = "Public Evaluator · WorkChat Lab";
  resetEvaluator();
  initializeLiveEvaluator();

  byId("evaluator-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMatchedMessage();
  });
  byId("evaluator-reset").addEventListener("click", resetEvaluator);
  document.querySelectorAll("[data-evaluator-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      byId("evaluator-input").value =
        PRESETS.en[button.dataset.evaluatorPreset] ?? "";
      byId("evaluator-input").focus();
    });
  });
}

function initializeLiveEvaluator() {
  const settings = readRemoteSettings();
  if (settings.apiBaseUrl) {
    liveApi = createRemoteApi(settings);
    liveApi
      .health()
      .then((health) => {
        setLiveStatus(
          health.apiConfigured ? `${health.model} API ready` : "API not configured",
          health.apiConfigured ? "ready" : "error",
        );
      })
      .catch(() => setLiveStatus("Backend unavailable", "error"));
  } else {
    setLiveStatus("Backend URL unavailable", "error");
  }

  byId("live-evaluator-start").addEventListener(
    "click",
    startLiveEvaluatorSession,
  );
  byId("live-evaluator-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendLiveEvaluatorMessage();
  });
  document.querySelectorAll("[data-live-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const locale = byId("live-evaluator-language").value;
      byId("live-evaluator-input").value =
        PRESETS[locale]?.[button.dataset.livePreset] ??
        PRESETS.en[button.dataset.livePreset] ??
        "";
      byId("live-evaluator-input").focus();
    });
  });
}

async function startLiveEvaluatorSession() {
  if (!liveApi) {
    setLiveStatus("Backend unavailable", "error");
    return;
  }
  const condition = byId("live-evaluator-condition").value;
  const language = byId("live-evaluator-language").value;
  const startButton = byId("live-evaluator-start");
  startButton.disabled = true;
  setLiveComposerEnabled(false);
  setLiveStatus("Creating secure QA session…", "working");
  try {
    const payload = await liveApi.createEvaluatorSession(condition, language);
    liveToken = payload.participantToken;
    liveSession = payload.session;
    liveCondition = payload.condition;
    renderLiveMessages(liveSession.messages);
    byId("live-evaluator-meta").innerHTML =
      `<strong>${escapeHtml(conditionLabel(liveCondition))}</strong>` +
      `<span>${escapeHtml(payload.model)} · QA session · excluded from formal metrics</span>`;
    byId("live-evaluator-input").placeholder =
      language === "zh-CN" ? "输入消息…" : "Type a message…";
    setLiveComposerEnabled(true);
    setLiveStatus("Live API session active", "active");
    byId("live-evaluator-input").focus();
  } catch (error) {
    liveToken = "";
    liveSession = null;
    liveCondition = "";
    renderLiveError(error.message);
    setLiveStatus("Could not start API session", "error");
  } finally {
    startButton.disabled = false;
  }
}

async function sendLiveEvaluatorMessage() {
  const input = byId("live-evaluator-input");
  const text = input.value.trim();
  if (!text || !liveApi || !liveToken || !liveSession || input.disabled) {
    return;
  }
  input.value = "";
  const optimistic = {
    id: `live-${Date.now()}`,
    role: "participant",
    text,
    kind: "participant_message",
  };
  renderLiveMessages([...liveSession.messages, optimistic]);
  setLiveComposerEnabled(false);
  setLiveStatus("DeepSeek is responding…", "working");
  try {
    const payload = await liveApi.sendMessage(liveToken, text);
    liveSession = payload.session;
    renderLiveMessages(liveSession.messages);
    const last = liveSession.messages.at(-1);
    setLiveStatus(
      last?.kind === "condition_reaction"
        ? `${conditionLabel(liveCondition)} reaction delivered`
        : "Live API session active",
      "active",
    );
  } catch (error) {
    renderLiveMessages(liveSession.messages);
    renderLiveError(error.message, true);
    setLiveStatus("API request failed", "error");
  } finally {
    setLiveComposerEnabled(true);
    input.focus();
  }
}

function renderLiveMessages(messages) {
  const container = byId("live-evaluator-chat");
  container.replaceChildren(
    ...messages.map((message) => {
      const element = messageElement(message);
      if (message.kind === "condition_reaction") {
        element.classList.add("condition-reaction");
      }
      return element;
    }),
  );
  container.scrollTop = container.scrollHeight;
}

function renderLiveError(message, append = false) {
  const container = byId("live-evaluator-chat");
  if (!append) container.replaceChildren();
  const error = document.createElement("div");
  error.className = "live-evaluator-error";
  error.textContent = message;
  container.append(error);
}

function setLiveComposerEnabled(enabled) {
  byId("live-evaluator-input").disabled = !enabled;
  byId("live-evaluator-send").disabled = !enabled;
}

function setLiveStatus(text, state) {
  const status = byId("live-evaluator-status");
  status.textContent = text;
  status.dataset.state = state;
}

function resetEvaluator() {
  sessions = new Map(
    CONDITIONS.map((condition, index) => {
      const session = startSession(
        createSession({
          condition,
          participantCode: `PUBLIC-QA-${index + 1}`,
          sessionPurpose: "qa",
          config: DEFAULT_CONFIG,
          id: `public-${condition}`,
        }),
      );
      return [condition, session];
    }),
  );
  byId("evaluator-input").value = "";
  byId("evaluator-audit").textContent =
    "Waiting for a participant message. Use the suggested sequence or enter your own text.";
  renderAll();
}

function sendMatchedMessage() {
  const input = byId("evaluator-input");
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }

  const audit = auditJoke(text, { expectedJoke: DEFAULT_CONFIG.targetJoke });
  for (const condition of CONDITIONS) {
    const current = sessions.get(condition);
    if (!current || ["completed", "technical_failure"].includes(current.status)) {
      continue;
    }
    sessions.set(
      condition,
      submitParticipantMessage(current, text).session,
    );
  }

  const detected = audit.label === "joke" && audit.confidence >= 0.75;
  byId("evaluator-audit").innerHTML = detected
    ? `<strong>Joke signal detected</strong><span>${escapeHtml(audit.method)} · confidence ${Math.round(audit.confidence * 100)}% · one-time reaction slot delivered</span>`
    : `<strong>No joke signal</strong><span>${escapeHtml(audit.method)} · confidence ${Math.round(audit.confidence * 100)}% · shared coworker path retained</span>`;
  input.value = "";
  renderAll();
}

function renderAll() {
  for (const condition of CONDITIONS) {
    const container = document.querySelector(
      `[data-evaluator-messages="${condition}"]`,
    );
    const session = sessions.get(condition);
    if (!container || !session) continue;
    container.replaceChildren(
      ...session.messages.map((message) => messageElement(message)),
    );
    container.scrollTop = container.scrollHeight;
  }
}

function messageElement(message) {
  const row = document.createElement("div");
  row.className = `evaluator-message ${message.role}`;

  const label = document.createElement("span");
  label.className = "evaluator-speaker";
  label.textContent = message.role === "participant" ? "You" : "Alex";

  const bubble = document.createElement("p");
  bubble.textContent = message.text;
  row.append(label, bubble);
  return row;
}

function byId(id) {
  return document.getElementById(id);
}

function show(id) {
  byId(id)?.classList.remove("hidden");
}

function hide(id) {
  byId(id)?.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
