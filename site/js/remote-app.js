import {
  CONDITIONS,
  DEFAULT_CONFIG,
  clone,
  conditionLabel,
  normalizeConfig,
} from "./core.js";
import { createRemoteApi } from "./remote-api.js";

const CONFIG_KEY = "workchat-lab::config";

export async function initializeRemoteApp({
  view,
  sessionToken,
  settings,
}) {
  const api = createRemoteApi(settings);
  if (view === "participant") {
    await initializeParticipant(api, settings, sessionToken);
  } else {
    await initializeResearcher(api, settings);
  }
}

async function initializeResearcher(api, settings) {
  show("researcher-view");
  hide("participant-view");
  markLiveMode();
  const config = readConfig();
  renderConfiguration(config);
  bindResearcherEvents(api, settings);
  await refreshResearcher(api, settings);
}

function bindResearcherEvents(api, settings) {
  byId("configuration-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const previous = readConfig();
    const config = normalizeConfig({
      ...previous,
      ...readConfigurationForm(),
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
    });
    writeConfig(config);
    renderConfiguration(config);
    await refreshResearcher(api, settings);
    toast(`Experiment settings saved as version ${config.version}.`);
  });

  byId("configuration-form").addEventListener("input", () => {
    byId("save-indicator").textContent = "Unsaved changes";
    byId("save-indicator").classList.add("unsaved");
  });

  byId("reset-config").addEventListener("click", async () => {
    if (!window.confirm("Reset all experiment settings to the bilingual defaults?")) {
      return;
    }
    const reset = normalizeConfig({
      ...clone(DEFAULT_CONFIG),
      version: readConfig().version + 1,
      updatedAt: new Date().toISOString(),
    });
    writeConfig(reset);
    renderConfiguration(reset);
    await refreshResearcher(api, settings);
    toast("Bilingual default settings restored.");
  });

  const create = () => createResearchSession(api, settings);
  byId("create-session-top").addEventListener("click", create);
  byId("create-session-side").addEventListener("click", create);
  byId("preview-button").addEventListener("click", async () => {
    const payload = await api.createSession({
      assignmentMethod: "participant_blind",
      participantCode: "PREVIEW",
      config: readConfig(),
    });
    openParticipantSession(payload.session.participantToken, settings);
    await refreshResearcher(api, settings);
  });

  byId("session-table-body").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const token = button.dataset.participantToken;
    const id = button.dataset.sessionId;
    if (button.dataset.action === "open") {
      openParticipantSession(token, settings);
    } else if (button.dataset.action === "copy") {
      await copyParticipantLink(token, settings);
    } else if (button.dataset.action === "delete") {
      if (!window.confirm(`Delete session ${id}?`)) return;
      await api.deleteSession(id);
      await refreshResearcher(api, settings);
      toast(`Session ${id} deleted.`);
    }
  });

  byId("clear-sessions").addEventListener("click", async () => {
    if (!window.confirm("Delete all server-side prototype sessions?")) return;
    await api.clearSessions();
    await refreshResearcher(api, settings);
    toast("All server-side prototype sessions were deleted.");
  });

  byId("export-config").addEventListener("click", () => {
    downloadJson(`workchat-config-v${readConfig().version}.json`, readConfig());
  });

  byId("import-config").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const config = normalizeConfig({
        ...imported,
        version: readConfig().version + 1,
        updatedAt: new Date().toISOString(),
      });
      writeConfig(config);
      renderConfiguration(config);
      toast(`Configuration imported as version ${config.version}.`);
    } catch {
      toast("The selected file was not a valid experiment configuration.");
    } finally {
      event.target.value = "";
    }
  });

  byId("export-json").addEventListener("click", async () => {
    downloadJson("workchat-server-records.json", await api.exportSessions());
  });

  byId("export-csv").addEventListener("click", async () => {
    const payload = await api.exportSessions();
    downloadText(
      "workchat-session-summary.csv",
      toCsv(payload.sessions.map(sessionSummary)),
      "text/csv",
    );
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
}

async function createResearchSession(api, settings) {
  const selected = byId("condition-assignment").value;
  const participantCode = byId("participant-code").value.trim();
  if (selected === "qa_triplet") {
    const config = readConfig();
    for (const condition of CONDITIONS) {
      await api.createSession({
        assignmentMethod: "researcher_manual",
        condition,
        sessionPurpose: "qa",
        participantCode: `${participantCode || "QA"}-${condition}`,
        config,
      });
    }
    byId("participant-code").value = "";
    await refreshResearcher(api, settings);
    toast("QA test pack created: one independent session per condition.");
    return;
  }
  const manual = ["negative", "neutral", "polite_positive"].includes(selected);
  const assignmentMethod =
    selected === "participant_blind"
      ? "participant_blind"
      : manual
        ? "researcher_manual"
        : "balanced_random";
  const payload = await api.createSession({
    assignmentMethod,
    condition: manual ? selected : undefined,
    sessionPurpose: "research",
    participantCode,
    config: readConfig(),
  });
  byId("participant-code").value = "";
  await refreshResearcher(api, settings);
  const message =
    assignmentMethod === "participant_blind"
      ? `Session ${payload.session.id} created. The participant will make a blind card choice.`
      : `Session ${payload.session.id} created and condition-locked.`;
  toast(message);
}

async function refreshResearcher(api, settings) {
  try {
    const [health, payload] = await Promise.all([
      api.health(),
      api.listSessions(),
    ]);
    renderSessions(payload.sessions, settings);
    renderMetrics(payload.sessions);
    byId("backend-status").textContent = health.apiConfigured
      ? `${health.model} connected`
      : "Backend online · model key missing";
    byId("backend-status").classList.toggle("connected", health.apiConfigured);
  } catch (error) {
    if (error.status === 401) {
      byId("backend-status").textContent = "Researcher key rejected";
    } else {
      byId("backend-status").textContent = "Backend unavailable";
    }
    toast(error.message);
  }
}

function renderSessions(sessions, settings) {
  const body = byId("session-table-body");
  body.replaceChildren();
  toggle("empty-sessions", sessions.length === 0);
  for (const session of sessions) {
    const row = document.createElement("tr");
    const condition = session.condition
      ? conditionLabel(session.condition)
      : "Awaiting blind choice";
    row.innerHTML = `
      <td><b>${escapeHtml(session.id)}</b><small>${escapeHtml(session.assignmentMethod)}${session.sessionPurpose === "qa" ? " · QA test" : ""}</small></td>
      <td>${escapeHtml(session.participantCode || "—")}</td>
      <td><span class="condition-badge ${escapeHtml(session.condition || "pending")}">${escapeHtml(condition)}</span></td>
      <td><span class="status-badge">${escapeHtml(displayStatus(session.status))}</span></td>
      <td>${escapeHtml(formatDateTime(session.createdAt))}</td>
      <td class="table-actions">
        <button class="icon-button" data-action="open" title="Open participant chat">↗</button>
        <button class="icon-button" data-action="copy" title="Copy participant link">⧉</button>
        <button class="icon-button danger-text" data-action="delete" title="Delete">×</button>
      </td>
    `;
    row.querySelectorAll("[data-action]").forEach((button) => {
      button.dataset.sessionId = session.id;
      button.dataset.participantToken = session.participantToken;
    });
    body.append(row);
  }
}

function renderMetrics(sessions) {
  const researchSessions = sessions.filter(
    (session) => session.sessionPurpose !== "qa",
  );
  byId("metric-total").textContent = String(researchSessions.length);
  byId("metric-treated").textContent = String(
    researchSessions.filter((session) => session.jokeSeen).length,
  );
  byId("metric-surveys").textContent = String(
    researchSessions.filter((session) => session.survey).length,
  );
  byId("metric-mode").textContent =
    readConfig().triggerMode === "study" ? "Study" : "Auto demo";
  byId("config-version-badge").textContent = `Config v${readConfig().version}`;
}

async function initializeParticipant(api, settings, token) {
  hide("researcher-view");
  show("participant-view");
  if (!token) return showParticipantError("The participant link is incomplete.");
  let session;
  try {
    session = (await api.getSession(token)).session;
  } catch (error) {
    return showParticipantError(error.message);
  }
  const locale =
    session.language ||
    (navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en");
  byId("participant-language").value = locale;
  renderParticipantIdentity(session);
  renderParticipantIntro(session, locale);
  bindParticipantEvents(api, token, session);

  if (["awaiting_choice", "created"].includes(session.status)) {
    show("participant-intro");
    return;
  }
  showChat(session);
  if (session.status === "survey_ready") show("survey-modal");
  if (session.status === "completed") {
    disableComposer();
    show("debrief-modal");
  }
}

function bindParticipantEvents(api, token, initialSession) {
  let session = initialSession;

  byId("participant-language").addEventListener("change", (event) => {
    renderParticipantIntro(session, event.target.value);
    applyParticipantLanguage(event.target.value);
  });

  byId("blind-card-grid").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-card]");
    if (!button || button.disabled) return;
    document.querySelectorAll("[data-card]").forEach((item) => {
      item.disabled = true;
    });
    try {
      session = (await api.chooseCard(token, button.dataset.card)).session;
      renderParticipantIntro(session, byId("participant-language").value);
      toast(
        byId("participant-language").value === "zh-CN"
          ? "聊天入口已确认。"
          : "Chat entry confirmed.",
      );
    } catch (error) {
      document.querySelectorAll("[data-card]").forEach((item) => {
        item.disabled = false;
      });
      toast(error.message);
    }
  });

  byId("start-conversation").addEventListener("click", async () => {
    try {
      const response = await api.startSession(
        token,
        byId("participant-language").value,
      );
      session = response.session;
      hide("participant-intro");
      show("chat-shell");
      renderMessages([]);
      await showTypingFor(response.delayMs);
      renderMessages(session.messages);
      focusComposer();
    } catch (error) {
      toast(error.message);
    }
  });

  byId("message-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    session = await sendParticipantMessage(api, token, session);
  });

  byId("message-input").addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      session = await sendParticipantMessage(api, token, session);
    }
  });

  byId("end-conversation").addEventListener("click", async () => {
    if (!window.confirm(localizedText("endConfirm", session.language))) return;
    try {
      session = (await api.endSession(token)).session;
      show("survey-modal");
    } catch (error) {
      toast(error.message);
    }
  });

  byId("ai-likelihood").addEventListener("input", (event) => {
    byId("ai-likelihood-output").value = event.target.value;
    positionRangeOutput(event.target, byId("ai-likelihood-output"));
  });

  byId("survey-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      session = (await api.submitSurvey(token, values)).session;
      hide("survey-modal");
      show("debrief-modal");
      disableComposer();
    } catch (error) {
      toast(error.message);
    }
  });

  byId("close-debrief").addEventListener("click", () => {
    hide("debrief-modal");
    byId("chat-status").textContent = localizedText(
      "studyComplete",
      session.language,
    );
  });
}

async function sendParticipantMessage(api, token, currentSession) {
  const input = byId("message-input");
  const text = input.value.trim();
  if (!text || input.disabled) return currentSession;
  input.value = "";
  disableComposer();
  const optimistic = {
    id: `local-${Date.now()}`,
    role: "participant",
    text,
    timestamp: new Date().toISOString(),
  };
  renderMessages([...currentSession.messages, optimistic]);
  try {
    const response = await api.sendMessage(token, text);
    const session = response.session;
    const withoutLastAssistant =
      session.messages.at(-1)?.role === "assistant"
        ? session.messages.slice(0, -1)
        : session.messages;
    renderMessages(withoutLastAssistant);
    await showTypingFor(response.delayMs);
    renderMessages(session.messages);
    if (response.shouldOfferSurvey) {
      await wait(500);
      show("survey-modal");
    } else {
      enableComposer();
      focusComposer();
    }
    return session;
  } catch (error) {
    toast(error.message);
    renderMessages(currentSession.messages);
    enableComposer();
    focusComposer();
    return currentSession;
  }
}

function renderParticipantIntro(session, locale) {
  const normalized = locale === "zh-CN" ? "zh-CN" : "en";
  const intro = session.intros[normalized] || session.intros.en;
  byId("participant-scenario").textContent = intro.scenario;
  byId("participant-target-joke").textContent = intro.targetJoke;
  toggle("blind-choice-panel", session.requiresChoice);
  toggle("participant-study-details", !session.requiresChoice);
  byId("start-conversation").disabled = session.requiresChoice;
  applyParticipantLanguage(normalized);
}

function renderParticipantIdentity(session) {
  document.title = `${session.coworkerName} · Workplace chat`;
  document.querySelectorAll(".coworker-name-text").forEach((element) => {
    element.textContent = session.coworkerName;
  });
  const initial = session.coworkerName.slice(0, 1).toUpperCase();
  document.querySelectorAll(".coworker-avatar").forEach((element) => {
    element.textContent = initial;
  });
  byId("intro-avatar").textContent = initial;
  byId("conversation-time").textContent = formatClock(new Date().toISOString());
}

function applyParticipantLanguage(locale) {
  const chinese = locale === "zh-CN";
  byId("participant-intro-title").textContent = chinese
    ? "与一位同事进行简短对话"
    : "A short conversation with a coworker";
  byId("blind-choice-title").textContent = chinese
    ? "请选择任意一个聊天入口"
    : "Choose any chat entry";
  byId("blind-choice-copy").textContent = chinese
    ? "这些入口外观相同，仅用于建立本次会话。选择后不能更改。"
    : "The identical entries are only used to establish this conversation. Your choice cannot be changed.";
  byId("participant-task-label").textContent = chinese ? "你的任务" : "Your task";
  byId("participant-task-copy").textContent = chinese
    ? "请自然回应。至少进行一次与工作相关的交流后，在你觉得合适的时机讲出下面准备好的笑话。不要等待同事主动询问。"
    : "Respond naturally. After at least one work-related exchange, introduce the prepared joke below when it feels natural. Do not wait for your coworker to ask for it.";
  byId("start-conversation").textContent = chinese
    ? "开始对话"
    : "Start conversation";
  byId("message-input").placeholder = chinese ? "输入消息" : "Type a message";
  byId("send-button").textContent = chinese ? "发送" : "Send";
}

function showChat(session) {
  hide("participant-intro");
  show("chat-shell");
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
    avatar.textContent =
      message.role === "participant"
        ? "P"
        : byId("intro-avatar").textContent || "A";
    if (message.role === "assistant") avatar.classList.add("coworker-avatar");
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = message.text;
    row.append(avatar, bubble);
    list.append(row);
  }
  list.scrollTop = list.scrollHeight;
}

function readConfigurationForm() {
  return {
    coworkerName: byId("coworker-name").value,
    participantLabel: byId("participant-label").value,
    scenarioText: byId("scenario-text").value,
    scenarioTextZh: byId("scenario-text-zh").value,
    openingMessage: byId("opening-message").value,
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

function renderConfiguration(configInput) {
  const config = normalizeConfig(configInput);
  const values = {
    "coworker-name": config.coworkerName,
    "participant-label": config.participantLabel,
    "scenario-text": config.scenarioText,
    "scenario-text-zh": config.scenarioTextZh,
    "opening-message": config.openingMessage,
    "trigger-mode": config.triggerMode,
    "pre-joke-turns": config.preJokeTurns,
    "joke-cue": config.jokeCue,
    "joke-cue-zh": config.jokeCueZh,
    "target-joke": config.targetJoke,
    "target-joke-zh": config.targetJokeZh,
    "negative-reaction": config.negativeReaction,
    "negative-reaction-zh": config.negativeReactionZh,
    "neutral-reaction": config.neutralReaction,
    "neutral-reaction-zh": config.neutralReactionZh,
    "positive-reaction": config.positiveReaction,
    "positive-reaction-zh": config.positiveReactionZh,
    "canonical-reaction": config.canonicalReaction,
    "canonical-reaction-zh": config.canonicalReactionZh,
    "reaction-delay": config.reactionDelayMs,
    "post-joke-turns": config.postJokeTurns,
  };
  for (const [id, value] of Object.entries(values)) {
    byId(id).value = value;
  }
  byId("save-indicator").textContent = "Saved in this researcher browser";
  byId("save-indicator").classList.remove("unsaved");
}

function readConfig() {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) return normalizeConfig(JSON.parse(stored));
  } catch {
    // Fall through to a fresh, validated default.
  }
  const config = normalizeConfig({
    ...clone(DEFAULT_CONFIG),
    updatedAt: new Date().toISOString(),
  });
  writeConfig(config);
  return config;
}

function writeConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalizeConfig(config)));
}

function markLiveMode() {
  const notice = document.querySelector(".prototype-notice");
  notice?.classList.add("live-notice");
  const title = notice?.querySelector("strong");
  const copy = notice?.querySelector("p");
  if (title) title.textContent = "Secure DeepSeek backend mode";
  if (copy) {
    copy.textContent =
      "Conversations use DeepSeek V4 Flash through a server-side proxy. API credentials and condition mappings are never sent to participants.";
  }
  const sidebarTitle = document.querySelector(".sidebar-bottom strong");
  const sidebarCopy = document.querySelector(".sidebar-bottom small");
  if (sidebarTitle) sidebarTitle.textContent = "Server mode";
  if (sidebarCopy) sidebarCopy.textContent = "DeepSeek V4 Flash";
}

function openParticipantSession(token, settings) {
  window.open(participantUrl(token, settings), "_blank", "noopener");
}

async function copyParticipantLink(token, settings) {
  const value = participantUrl(token, settings);
  try {
    await navigator.clipboard.writeText(value);
    toast("Participant link copied.");
  } catch {
    window.prompt("Copy this participant link:", value);
  }
}

function participantUrl(token, settings) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "participant");
  url.searchParams.set("session", token);
  return url.toString();
}

function sessionSummary(session) {
  return {
    session_id: session.id,
    participant_code: session.participantCode,
    session_purpose: session.sessionPurpose || "research",
    assignment_method: session.assignmentMethod,
    selected_card: session.selectedCard || "",
    condition: session.condition || "",
    status: session.status,
    language: session.language || "",
    joke_seen: session.jokeSeen,
    created_at: session.createdAt,
    started_at: session.startedAt || "",
    completed_at: session.completedAt || "",
    identity_guess: session.survey?.identityGuess || "",
    ai_likelihood: session.survey?.aiLikelihood ?? "",
    reaction_valence: session.survey?.reactionValence ?? "",
    disapproval: session.survey?.disapproval ?? "",
    naturalness: session.survey?.naturalness ?? "",
  };
}

function showParticipantError(message) {
  hide("participant-intro");
  hide("chat-shell");
  const copy = byId("participant-error-message");
  if (copy) copy.textContent = message;
  show("participant-error");
}

async function showTypingFor(milliseconds) {
  show("typing-indicator");
  byId("chat-status").textContent = "Typing…";
  await wait(Math.max(150, Math.min(1800, Number(milliseconds) || 700)));
  hide("typing-indicator");
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

function localizedText(key, locale) {
  const chinese = locale === "zh-CN";
  const copy = {
    endConfirm: chinese
      ? "结束对话并进入简短问卷吗？"
      : "Finish the conversation and continue to the short questionnaire?",
    studyComplete: chinese ? "研究已完成" : "Study complete",
  };
  return copy[key] || "";
}

function displayStatus(status) {
  return (
    {
      awaiting_choice: "Awaiting choice",
      created: "Ready",
      active: "In conversation",
      treatment_delivered: "Reaction delivered",
      survey_ready: "Survey ready",
      completed: "Completed",
    }[status] || status
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
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
  ].join("\n");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
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

function show(id) {
  byId(id)?.classList.remove("hidden");
}

function hide(id) {
  byId(id)?.classList.add("hidden");
}

function toggle(id, shouldShow) {
  byId(id)?.classList.toggle("hidden", !shouldShow);
}

let toastTimer;
function toast(message) {
  const element = byId("toast");
  if (!element) return;
  window.clearTimeout(toastTimer);
  element.textContent = message;
  element.classList.remove("hidden");
  toastTimer = window.setTimeout(() => element.classList.add("hidden"), 3600);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
