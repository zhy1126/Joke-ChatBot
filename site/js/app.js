import {
  CONDITIONS,
  DEFAULT_CONFIG,
  chooseBalancedCondition,
  clone,
  completeSurvey,
  conditionLabel,
  createSession,
  markSessionSurveyReady,
  normalizeConfig,
  sessionToCsvRow,
  startSession,
  submitParticipantMessage,
} from "./core.js";
import { initializeRemoteApp } from "./remote-app.js";
import {
  createRemoteApi,
  readRemoteSettings,
  remoteModeAvailable,
  saveRemoteSettings,
} from "./remote-api.js";

const STORAGE_KEYS = Object.freeze({
  config: "workchat-lab::config",
  sessions: "workchat-lab::sessions",
});

const CONDITION_CLASSES = Object.freeze({
  negative: "negative",
  neutral: "neutral",
  polite_positive: "polite_positive",
});

const parameters = new URLSearchParams(window.location.search);
const activeView = parameters.get("view") ?? "researcher";
const activeSessionId = parameters.get("session");
const remoteSettings = readRemoteSettings();

bindBackendConnection(remoteSettings);

if (remoteModeAvailable(activeView, remoteSettings)) {
  try {
    await initializeRemoteApp({
      view: activeView,
      sessionToken: activeSessionId,
      settings: remoteSettings,
    });
  } catch (error) {
    console.error("remote_app_initialization_failed", error);
    if (activeView === "participant") {
      hideElement("researcher-view");
      showElement("participant-view");
      showElement("participant-error");
      const message = byId("participant-error-message");
      if (message) message.textContent = error.message;
    } else {
      initializeResearcher();
      showToast(error.message);
    }
  }
} else if (activeView === "participant") {
  initializeParticipant(activeSessionId);
} else {
  initializeResearcher();
}

function bindBackendConnection(settings) {
  const form = byId("backend-connection-form");
  if (!form) return;
  byId("backend-api-url").value = settings.apiBaseUrl;
  byId("backend-api-url").readOnly = true;
  byId("researcher-access-key").value = settings.researcherKey;
  byId("backend-status").textContent = settings.apiBaseUrl
    ? settings.researcherKey
      ? "Connection saved for this tab"
      : "API URL saved · enter researcher key"
    : "Offline prototype mode";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = saveRemoteSettings({
      researcherKey: byId("researcher-access-key").value,
    });
    if (!next.apiBaseUrl) {
      showToast("Deploy the Worker and set its URL in runtime-config.js first.");
      return;
    }
    try {
      const health = await createRemoteApi(next).health();
      if (!health.ok) throw new Error("Backend health check failed.");
      byId("backend-status").textContent = `${health.model} backend reached`;
      window.setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      byId("backend-status").textContent = "Backend unavailable";
      showToast(error.message);
    }
  });
}

function initializeResearcher() {
  showElement("researcher-view");
  hideElement("participant-view");
  renderConfiguration(readConfig());
  renderResearcherState();
  bindResearcherEvents();
}

function bindResearcherEvents() {
  byId("configuration-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const previous = readConfig();
    const config = normalizeConfig({
      ...readConfigurationForm(),
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
    });
    writeConfig(config);
    renderConfiguration(config);
    renderResearcherState();
    showToast(`Experiment settings saved as version ${config.version}.`);
  });

  byId("configuration-form").addEventListener("input", () => {
    byId("save-indicator").textContent = "Unsaved changes";
    byId("save-indicator").classList.add("unsaved");
  });

  byId("reset-config").addEventListener("click", () => {
    if (!window.confirm("Reset all experiment settings to the prototype defaults?")) {
      return;
    }
    const current = readConfig();
    const reset = normalizeConfig({
      ...clone(DEFAULT_CONFIG),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    writeConfig(reset);
    renderConfiguration(reset);
    renderResearcherState();
    showToast("Default experiment settings restored.");
  });

  byId("create-session-top").addEventListener("click", createResearchSession);
  byId("create-session-side").addEventListener("click", createResearchSession);
  byId("preview-button").addEventListener("click", () => {
    const session = createAndStoreSession("random", "PREVIEW");
    openParticipantSession(session.id);
  });

  byId("session-table-body").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, sessionId } = button.dataset;
    if (action === "open") {
      openParticipantSession(sessionId);
    }
    if (action === "copy") {
      await copyParticipantLink(sessionId);
    }
    if (action === "delete") {
      deleteSession(sessionId);
    }
  });

  byId("clear-sessions").addEventListener("click", () => {
    if (
      !window.confirm(
        "Delete every prototype session and survey stored in this browser? This cannot be undone.",
      )
    ) {
      return;
    }
    writeSessions([]);
    renderResearcherState();
    showToast("All browser-local prototype records were removed.");
  });

  byId("export-config").addEventListener("click", () => {
    downloadJson(
      `workchat-config-v${readConfig().version}.json`,
      readConfig(),
    );
  });

  byId("import-config").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const current = readConfig();
      const config = normalizeConfig({
        ...imported,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      });
      writeConfig(config);
      renderConfiguration(config);
      renderResearcherState();
      showToast(`Configuration imported as version ${config.version}.`);
    } catch {
      showToast("The selected file was not a valid experiment configuration.");
    } finally {
      event.target.value = "";
    }
  });

  byId("export-json").addEventListener("click", () => {
    downloadJson("workchat-anonymous-records.json", {
      exportedAt: new Date().toISOString(),
      config: readConfig(),
      sessions: readSessions(),
    });
  });

  byId("export-csv").addEventListener("click", () => {
    const rows = readSessions().map(sessionToCsvRow);
    downloadText("workchat-session-summary.csv", toCsv(rows), "text/csv");
  });

  document.querySelectorAll("[data-scroll-to]").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-scroll-to]")
        .forEach((candidate) => candidate.classList.remove("active"));
      button.classList.add("active");
      byId(button.dataset.scrollTo)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  });

  window.addEventListener("storage", renderResearcherState);
}

function readConfigurationForm() {
  return {
    coworkerName: byId("coworker-name").value,
    participantLabel: byId("participant-label").value,
    scenarioText: byId("scenario-text").value,
    scenarioTextZh: byId("scenario-text-zh").value,
    openingMessage: byId("opening-message").value,
    openingMessageZh: byId("opening-message-zh").value,
    triggerMode: byId("trigger-mode").value,
    preJokeTurns: byId("pre-joke-turns").value,
    jokeCue: byId("joke-cue").value,
    jokeCueZh: byId("joke-cue-zh").value,
    targetJoke: byId("target-joke").value,
    targetJokeZh: byId("target-joke-zh").value,
    negativeReaction: byId("negative-reaction").value,
    negativeReactionZh: byId("negative-reaction-zh").value,
    neutralReaction: byId("neutral-reaction").value,
    neutralReactionZh: byId("neutral-reaction-zh").value,
    positiveReaction: byId("positive-reaction").value,
    positiveReactionZh: byId("positive-reaction-zh").value,
    canonicalReaction: byId("canonical-reaction").value,
    canonicalReactionZh: byId("canonical-reaction-zh").value,
    reactionDelayMs: byId("reaction-delay").value,
    postJokeTurns: byId("post-joke-turns").value,
  };
}

function renderConfiguration(config) {
  byId("coworker-name").value = config.coworkerName;
  byId("participant-label").value = config.participantLabel;
  byId("scenario-text").value = config.scenarioText;
  byId("scenario-text-zh").value = config.scenarioTextZh;
  byId("opening-message").value = config.openingMessage;
  byId("opening-message-zh").value = config.openingMessageZh;
  byId("trigger-mode").value = config.triggerMode;
  byId("pre-joke-turns").value = config.preJokeTurns;
  byId("joke-cue").value = config.jokeCue;
  byId("joke-cue-zh").value = config.jokeCueZh;
  byId("target-joke").value = config.targetJoke;
  byId("target-joke-zh").value = config.targetJokeZh;
  byId("negative-reaction").value = config.negativeReaction;
  byId("negative-reaction-zh").value = config.negativeReactionZh;
  byId("neutral-reaction").value = config.neutralReaction;
  byId("neutral-reaction-zh").value = config.neutralReactionZh;
  byId("positive-reaction").value = config.positiveReaction;
  byId("positive-reaction-zh").value = config.positiveReactionZh;
  byId("canonical-reaction").value = config.canonicalReaction;
  byId("canonical-reaction-zh").value = config.canonicalReactionZh;
  byId("reaction-delay").value = config.reactionDelayMs;
  byId("post-joke-turns").value = config.postJokeTurns;
  byId("save-indicator").textContent = "Saved locally";
  byId("save-indicator").classList.remove("unsaved");
}

function createResearchSession() {
  const assignment = byId("condition-assignment").value;
  if (assignment === "participant_blind") {
    showToast("Participant blind choice requires the secure server backend.");
    return;
  }
  const participantCode = byId("participant-code").value.trim();
  const session = createAndStoreSession(assignment, participantCode);
  byId("participant-code").value = "";
  renderResearcherState();
  showToast(
    `Session ${session.id} created. The condition is locked and hidden from the participant view.`,
  );
}

function createAndStoreSession(assignment, participantCode) {
  const sessions = readSessions();
  const condition = CONDITIONS.includes(assignment)
    ? assignment
    : chooseBalancedCondition(sessions, secureRandom);
  const session = createSession({
    condition,
    participantCode,
    config: readConfig(),
  });
  sessions.unshift(session);
  writeSessions(sessions);
  return session;
}

function renderResearcherState() {
  const config = readConfig();
  const sessions = readSessions();
  byId("metric-total").textContent = String(sessions.length);
  byId("metric-treated").textContent = String(
    sessions.filter((session) => session.jokeSeen).length,
  );
  byId("metric-surveys").textContent = String(
    sessions.filter((session) => session.survey).length,
  );
  byId("metric-mode").textContent =
    config.triggerMode === "study" ? "Study" : "Auto demo";
  byId("config-version-badge").textContent = `Config v${config.version}`;

  const body = byId("session-table-body");
  body.replaceChildren();
  toggleElement("empty-sessions", sessions.length === 0);
  for (const session of sessions) {
    const row = document.createElement("tr");
    const statusClass = session.status === "completed" ? " completed" : "";
    row.innerHTML = `
      <td><span class="session-id">${escapeHtml(session.id)}</span></td>
      <td>${escapeHtml(session.participantCode || "—")}</td>
      <td>
        <span class="condition-pill ${CONDITION_CLASSES[session.condition]}">
          ${escapeHtml(conditionLabel(session.condition))}
        </span>
      </td>
      <td><span class="status-pill${statusClass}">${escapeHtml(displayStatus(session.status))}</span></td>
      <td>${escapeHtml(formatDateTime(session.createdAt))}</td>
      <td>
        <div class="session-actions">
          <button class="icon-button" data-action="open" data-session-id="${escapeHtml(session.id)}" title="Open participant chat">↗</button>
          <button class="icon-button" data-action="copy" data-session-id="${escapeHtml(session.id)}" title="Copy participant link">⧉</button>
          <button class="icon-button delete" data-action="delete" data-session-id="${escapeHtml(session.id)}" title="Delete session">×</button>
        </div>
      </td>
    `;
    body.append(row);
  }
}

function openParticipantSession(sessionId) {
  window.open(participantUrl(sessionId), "_blank", "noopener");
}

async function copyParticipantLink(sessionId) {
  try {
    await navigator.clipboard.writeText(participantUrl(sessionId));
    showToast("Participant link copied.");
  } catch {
    window.prompt("Copy this participant link:", participantUrl(sessionId));
  }
}

function participantUrl(sessionId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "participant");
  url.searchParams.set("session", sessionId);
  return url.toString();
}

function deleteSession(sessionId) {
  const session = readSessions().find((item) => item.id === sessionId);
  if (!session) return;
  if (!window.confirm(`Delete prototype session ${sessionId}?`)) return;
  writeSessions(readSessions().filter((item) => item.id !== sessionId));
  renderResearcherState();
  showToast(`Session ${sessionId} deleted.`);
}

function initializeParticipant(sessionId) {
  hideElement("researcher-view");
  showElement("participant-view");
  const session = findSession(sessionId);
  if (!session) {
    showElement("participant-error");
    return;
  }

  const config = normalizeConfig(session.configSnapshot);
  byId("participant-language").value = "en";
  byId("participant-language").disabled = true;
  byId("participant-language").title =
    "Bilingual dialogue is available in secure DeepSeek backend mode.";
  document.title = `${config.coworkerName} · Workplace chat`;
  document.querySelectorAll(".coworker-name-text").forEach((element) => {
    element.textContent = config.coworkerName;
  });
  document.querySelectorAll(".coworker-avatar").forEach((element) => {
    element.textContent = config.coworkerName.slice(0, 1).toUpperCase();
  });
  byId("intro-avatar").textContent = config.coworkerName
    .slice(0, 1)
    .toUpperCase();
  byId("participant-scenario").textContent = config.scenarioText;
  byId("participant-target-joke").textContent = config.targetJoke;
  byId("conversation-time").textContent = formatClock(new Date().toISOString());

  bindParticipantEvents(sessionId);

  if (session.status === "created") {
    showElement("participant-intro");
    return;
  }

  showChat(session);
  if (session.status === "survey_ready") {
    showElement("survey-modal");
  }
  if (session.status === "completed") {
    disableComposer();
    showElement("debrief-modal");
  }
}

function bindParticipantEvents(sessionId) {
  byId("start-conversation").addEventListener("click", async () => {
    let session = findSession(sessionId);
    if (!session) return;
    const config = normalizeConfig(session.configSnapshot);
    session = startSession(session);
    replaceSession(session);
    hideElement("participant-intro");
    showElement("chat-shell");
    renderMessages([]);
    await showTypingFor(config.regularDelayMs);
    renderMessages(session.messages);
    focusComposer();
  });

  byId("message-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendParticipantMessage(sessionId);
  });

  byId("message-input").addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await sendParticipantMessage(sessionId);
    }
  });

  byId("end-conversation").addEventListener("click", () => {
    let session = findSession(sessionId);
    if (!session || session.status === "completed") return;
    if (
      !window.confirm(
        "Finish the conversation and continue to the short questionnaire?",
      )
    ) {
      return;
    }
    session = markSessionSurveyReady(session);
    replaceSession(session);
    showElement("survey-modal");
  });

  byId("ai-likelihood").addEventListener("input", (event) => {
    byId("ai-likelihood-output").value = event.target.value;
    positionRangeOutput(event.target, byId("ai-likelihood-output"));
  });

  byId("survey-form").addEventListener("submit", (event) => {
    event.preventDefault();
    let session = findSession(sessionId);
    if (!session) return;
    const formData = new FormData(event.currentTarget);
    session = completeSurvey(session, Object.fromEntries(formData.entries()));
    replaceSession(session);
    hideElement("survey-modal");
    showElement("debrief-modal");
    disableComposer();
  });

  byId("close-debrief").addEventListener("click", () => {
    hideElement("debrief-modal");
    byId("chat-status").textContent = "Study complete";
    showToast("Responses saved in the researcher dashboard on this browser.");
  });
}

async function sendParticipantMessage(sessionId) {
  const input = byId("message-input");
  const text = input.value.trim();
  if (!text || input.disabled) return;
  let session = findSession(sessionId);
  if (!session) return;

  input.value = "";
  disableComposer();
  let response;
  try {
    response = submitParticipantMessage(session, text);
  } catch (error) {
    showToast(error.message);
    enableComposer();
    return;
  }
  session = response.session;
  replaceSession(session);
  const withoutLastAssistant = session.messages.slice(0, -1);
  renderMessages(withoutLastAssistant);
  await showTypingFor(response.delayMs);
  renderMessages(session.messages);
  if (response.shouldOfferSurvey) {
    await wait(650);
    showElement("survey-modal");
  } else {
    enableComposer();
    focusComposer();
  }
}

function showChat(session) {
  hideElement("participant-intro");
  showElement("chat-shell");
  renderMessages(session.messages);
  if (["completed", "survey_ready"].includes(session.status)) {
    disableComposer();
  } else {
    enableComposer();
    focusComposer();
  }
}

function renderMessages(messages) {
  const list = byId("message-list");
  list.replaceChildren();
  if (messages.length) {
    const date = document.createElement("div");
    date.className = "message-date";
    date.textContent = `Today ${formatClock(messages[0].timestamp)}`;
    list.append(date);
  }
  for (const message of messages) {
    const row = document.createElement("article");
    row.className = `message-row ${
      message.role === "participant" ? "participant-message" : "assistant-message"
    }`;

    const avatar = document.createElement("div");
    avatar.className = "contact-avatar small-avatar";
    if (message.role === "participant") {
      avatar.textContent = "P";
    } else {
      avatar.classList.add("coworker-avatar");
      const session = findSession(activeSessionId);
      avatar.textContent = session?.configSnapshot?.coworkerName
        ?.slice(0, 1)
        .toUpperCase() || "A";
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = message.text;

    const meta = document.createElement("time");
    meta.className = "message-meta";
    meta.textContent = formatClock(message.timestamp);

    row.append(avatar, bubble, meta);
    list.append(row);
  }
  const lastMessage = messages.at(-1);
  if (lastMessage) {
    byId("conversation-preview").textContent = lastMessage.text;
    byId("conversation-time").textContent = formatClock(lastMessage.timestamp);
  }
  list.scrollTop = list.scrollHeight;
}

async function showTypingFor(milliseconds) {
  showElement("typing-indicator");
  byId("chat-status").textContent = "Typing…";
  await wait(Math.max(150, Number(milliseconds) || 700));
  hideElement("typing-indicator");
  byId("chat-status").textContent = "Online";
}

function disableComposer() {
  byId("message-input").disabled = true;
  byId("send-button").disabled = true;
}

function enableComposer() {
  byId("message-input").disabled = false;
  byId("send-button").disabled = false;
}

function focusComposer() {
  byId("message-input").focus({ preventScroll: true });
}

function readConfig() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.config);
    if (!stored) {
      const initial = normalizeConfig({
        ...clone(DEFAULT_CONFIG),
        updatedAt: new Date().toISOString(),
      });
      writeConfig(initial);
      return initial;
    }
    return normalizeConfig(JSON.parse(stored));
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

function writeConfig(config) {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(normalizeConfig(config)));
}

function readSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.sessions) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions) {
  localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
}

function findSession(sessionId) {
  return readSessions().find((session) => session.id === sessionId) ?? null;
}

function replaceSession(updated) {
  const sessions = readSessions();
  const index = sessions.findIndex((session) => session.id === updated.id);
  if (index === -1) sessions.unshift(updated);
  else sessions[index] = updated;
  writeSessions(sessions);
}

function secureRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 2 ** 32;
  }
  return Math.random();
}

function displayStatus(status) {
  return (
    {
      created: "Ready",
      active: "In conversation",
      treatment_delivered: "Reaction delivered",
      survey_ready: "Survey ready",
      completed: "Completed",
      technical_failure: "Technical failure",
    }[status] ?? status
  );
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toCsv(rows) {
  if (!rows.length) return "session_id\n";
  const headers = Object.keys(rows[0]);
  const values = rows.map((row) =>
    headers.map((header) => csvCell(row[header])).join(","),
  );
  return [headers.join(","), ...values].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadJson(filename, value) {
  downloadText(filename, JSON.stringify(value, null, 2), "application/json");
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function positionRangeOutput(range, output) {
  const percentage = Number(range.value) / Number(range.max);
  output.style.left = `calc(${percentage * 100}% - ${percentage * 34}px)`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function byId(id) {
  return document.getElementById(id);
}

function showElement(id) {
  byId(id)?.classList.remove("hidden");
}

function hideElement(id) {
  byId(id)?.classList.add("hidden");
}

function toggleElement(id, shouldShow) {
  byId(id)?.classList.toggle("hidden", !shouldShow);
}

let toastTimer;
function showToast(message) {
  const toast = byId("toast");
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
