import {
  CONDITIONS,
  DEFAULT_CONFIG,
  auditJoke,
  createSession,
  startSession,
  submitParticipantMessage,
} from "./core.js";

const PRESETS = Object.freeze({
  work: "The March heading is inconsistent. I’ll change it to “March 2026.”",
  progress: "The March heading is changed now.",
  joke:
    "Why did the spreadsheet break up with the database? It had too many relationship problems.",
  closure: "Everything is done now. There is nothing else to handle.",
});

let sessions = new Map();

export function initializeEvaluator() {
  hide("researcher-view");
  hide("participant-view");
  show("evaluator-view");
  document.title = "Public Evaluator · WorkChat Lab";
  resetEvaluator();

  byId("evaluator-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMatchedMessage();
  });
  byId("evaluator-reset").addEventListener("click", resetEvaluator);
  document.querySelectorAll("[data-evaluator-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      byId("evaluator-input").value =
        PRESETS[button.dataset.evaluatorPreset] ?? "";
      byId("evaluator-input").focus();
    });
  });
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
