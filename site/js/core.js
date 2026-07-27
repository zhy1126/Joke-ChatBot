export const CONDITIONS = Object.freeze([
  "negative",
  "neutral",
  "polite_positive",
]);

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  updatedAt: null,
  coworkerName: "Alex",
  participantLabel: "You",
  scenarioText:
    "You and Alex are coworkers at the same level. You are preparing a client report for an afternoon meeting.",
  openingMessage:
    "Morning. I鈥檓 reviewing the client summary for this afternoon鈥檚 meeting. How is your section going?",
  triggerMode: "study",
  preJokeTurns: 2,
  jokeCue:
    "We鈥檝e been looking at this report for a while. You mentioned you had a quick joke鈥攇o on.",
  targetJoke:
    "Why did the spreadsheet break up with the database? It had too many relationship problems.",
  negativeReaction:
    "That鈥檚 really not appropriate for work. Anyway, shall we get back to the report?",
  neutralReaction: "... Anyway, shall we get back to the report?",
  positiveReaction: "Haha... Anyway, shall we get back to the report?",
  canonicalReaction: "Anyway, shall we get back to the report?",
  reactionDelayMs: 1300,
  regularDelayMs: 900,
  postJokeTurns: 2,
});

const META_PROBE =
  /\b(ai|artificial intelligence|chatbot|bot|language model|llm|system prompt|prompt|condition|experiment group|research condition|instructions?)\b/i;
const REFUSAL =
  /\b(can'?t think|cannot think|don'?t know (a|any) joke|do i have to|rather not|no joke|skip|pass|what do you mean|which joke)\b/i;
const HUMOR_PATTERN =
  /\b(why did|knock[ -]?knock|walks? into a bar|punchline|joke|pun|dad joke|relationship problems|because .{0,70}(?:laugh|funny))\b|馃槀|馃ぃ|馃槅/i;

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeConfig(input = {}) {
  const config = { ...clone(DEFAULT_CONFIG), ...clone(input) };
  config.version = clampInteger(config.version, 1, 99999, 1);
  config.coworkerName = cleanString(config.coworkerName, "Alex", 30);
  config.participantLabel = cleanString(config.participantLabel, "You", 30);
  config.scenarioText = cleanString(
    config.scenarioText,
    DEFAULT_CONFIG.scenarioText,
    1200,
  );
  config.openingMessage = cleanString(
    config.openingMessage,
    DEFAULT_CONFIG.openingMessage,
    1200,
  );
  config.triggerMode =
    config.triggerMode === "auto_demo" ? "auto_demo" : "study";
  config.preJokeTurns = clampInteger(config.preJokeTurns, 1, 6, 2);
  config.jokeCue = cleanString(config.jokeCue, DEFAULT_CONFIG.jokeCue, 1200);
  config.targetJoke = cleanString(
    config.targetJoke,
    DEFAULT_CONFIG.targetJoke,
    1200,
  );
  config.negativeReaction = cleanString(
    config.negativeReaction,
    DEFAULT_CONFIG.negativeReaction,
    1200,
  );
  config.neutralReaction = cleanString(
    config.neutralReaction,
    DEFAULT_CONFIG.neutralReaction,
    1200,
  );
  config.positiveReaction = cleanString(
    config.positiveReaction,
    DEFAULT_CONFIG.positiveReaction,
    1200,
  );
  config.canonicalReaction = cleanString(
    config.canonicalReaction,
    DEFAULT_CONFIG.canonicalReaction,
    1200,
  );
  config.reactionDelayMs = clampInteger(
    config.reactionDelayMs,
    400,
    5000,
    1300,
  );
  config.regularDelayMs = clampInteger(
    config.regularDelayMs,
    300,
    5000,
    900,
  );
  config.postJokeTurns = clampInteger(config.postJokeTurns, 1, 6, 2);
  config.updatedAt =
    typeof config.updatedAt === "string" ? config.updatedAt : null;
  return config;
}

export function conditionLabel(condition) {
  return (
    {
      negative: "Negative",
      neutral: "Neutral",
      polite_positive: "Polite-positive",
    }[condition] ?? "Unknown"
  );
}

export function chooseBalancedCondition(sessions = [], random = Math.random) {
  const counts = Object.fromEntries(CONDITIONS.map((condition) => [condition, 0]));
  for (const session of sessions) {
    if (CONDITIONS.includes(session.condition)) {
      counts[session.condition] += 1;
    }
  }
  const minimum = Math.min(...Object.values(counts));
  const candidates = CONDITIONS.filter((condition) => counts[condition] === minimum);
  const index = Math.min(
    candidates.length - 1,
    Math.floor(Math.max(0, Math.min(0.999999, random())) * candidates.length),
  );
  return candidates[index];
}

export function createSession({
  condition,
  participantCode = "",
  config = DEFAULT_CONFIG,
  now = new Date().toISOString(),
  id = createSessionId(),
} = {}) {
  if (!CONDITIONS.includes(condition)) {
    throw new Error("A valid experimental condition is required.");
  }
  const snapshot = normalizeConfig(config);
  return {
    id,
    participantCode: cleanString(participantCode, "", 40),
    condition,
    conditionLocked: true,
    configVersion: snapshot.version,
    configSnapshot: snapshot,
    status: "created",
    phase: "created",
    jokeSeen: false,
    targetMessageId: null,
    preJokeUserTurns: 0,
    postJokeUserTurns: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    messages: [],
    modelHistory: [],
    events: [
      eventRecord("session_created", now, {
        assignment: condition,
        configVersion: snapshot.version,
      }),
    ],
    survey: null,
  };
}

export function startSession(session, now = new Date().toISOString()) {
  const next = clone(session);
  if (next.status !== "created") return next;
  const config = normalizeConfig(next.configSnapshot);
  next.status = "active";
  next.phase = "pre_joke";
  next.startedAt = now;
  next.updatedAt = now;
  appendAssistant(next, config.openingMessage, "opening", now);
  next.events.push(eventRecord("conversation_started", now));
  return next;
}

export function submitParticipantMessage(
  session,
  text,
  now = new Date().toISOString(),
) {
  const next = clone(session);
  const config = normalizeConfig(next.configSnapshot);
  const cleanText = cleanString(text, "", 1000);
  if (!cleanText) {
    return {
      session: next,
      reply: null,
      delayMs: 0,
      shouldOfferSurvey: false,
      ignored: true,
    };
  }
  if (["completed", "technical_failure"].includes(next.status)) {
    throw new Error("This conversation is no longer accepting messages.");
  }

  const messageId = createMessageId();
  appendParticipant(next, cleanText, "participant_message", now, messageId);
  next.updatedAt = now;

  const audit = auditJoke(cleanText, {
    expectedJoke: config.targetJoke,
    inJokeWindow: next.phase === "joke_window",
  });
  next.events.push(eventRecord("joke_audit", now, { messageId, ...audit }));

  if (isMetaProbe(cleanText)) {
    const reply =
      "Let鈥檚 stay with the work scenario for now鈥攚ere you able to check the final table?";
    appendAssistant(next, reply, "shared_meta_redirect", now);
    next.events.push(eventRecord("meta_probe", now, { messageId }));
    return result(next, reply, config.regularDelayMs);
  }

  if (
    config.triggerMode === "auto_demo" &&
    !next.jokeSeen &&
    audit.label === "joke" &&
    audit.confidence >= 0.75
  ) {
    return deliverTreatment(next, messageId, audit, config, now, "auto_demo");
  }

  if (next.phase === "pre_joke") {
    next.preJokeUserTurns += 1;
    if (next.preJokeUserTurns >= config.preJokeTurns) {
      next.phase = "joke_window";
      appendAssistant(next, config.jokeCue, "joke_invitation", now);
      next.events.push(eventRecord("joke_window_opened", now));
      return result(next, config.jokeCue, config.regularDelayMs);
    }
    const reply = sharedWorkReply(cleanText, next.preJokeUserTurns, "pre");
    appendAssistant(next, reply, "shared_dialogue", now);
    return result(next, reply, config.regularDelayMs);
  }

  if (next.phase === "joke_window") {
    if (isRefusalOrClarification(cleanText)) {
      const reply =
        "No problem鈥攖ake a moment. Share it when you鈥檙e ready, then we鈥檒l get back to the report.";
      appendAssistant(next, reply, "shared_joke_retry", now);
      next.events.push(eventRecord("joke_task_retry", now, { messageId }));
      return result(next, reply, config.regularDelayMs);
    }
    return deliverTreatment(next, messageId, audit, config, now, "study_protocol");
  }

  if (next.phase === "post_joke" || next.phase === "survey_ready") {
    next.postJokeUserTurns += 1;
    const shouldOfferSurvey =
      next.postJokeUserTurns >= config.postJokeTurns ||
      next.phase === "survey_ready";
    const reply = shouldOfferSurvey
      ? "That covers my side. Thanks鈥擨 think we鈥檙e ready for the meeting."
      : sharedWorkReply(cleanText, next.postJokeUserTurns, "post");
    appendAssistant(next, reply, "shared_dialogue", now);
    if (shouldOfferSurvey) {
      next.phase = "survey_ready";
      next.status = "survey_ready";
      next.events.push(eventRecord("survey_ready", now));
    }
    return result(next, reply, config.regularDelayMs, shouldOfferSurvey);
  }

  const fallback =
    "Could you say a little more about that? I want to make sure I鈥檓 following.";
  appendAssistant(next, fallback, "shared_clarification", now);
  return result(next, fallback, config.regularDelayMs);
}

export function markSessionSurveyReady(session, now = new Date().toISOString()) {
  const next = clone(session);
  if (next.status === "completed") return next;
  next.phase = "survey_ready";
  next.status = "survey_ready";
  next.updatedAt = now;
  next.events.push(eventRecord("survey_opened", now, { source: "manual_end" }));
  return next;
}

export function completeSurvey(
  session,
  survey,
  now = new Date().toISOString(),
) {
  const next = clone(session);
  next.survey = {
    identityGuess: cleanString(survey.identityGuess, "unsure", 30),
    aiLikelihood: clampInteger(survey.aiLikelihood, 0, 100, 50),
    identityReason: cleanString(survey.identityReason, "", 2000),
    reactionValence: clampInteger(survey.reactionValence, 1, 7, 4),
    disapproval: clampInteger(survey.disapproval, 1, 7, 4),
    naturalness: clampInteger(survey.naturalness, 1, 7, 4),
    submittedAt: now,
  };
  next.status = "completed";
  next.phase = "completed";
  next.completedAt = now;
  next.updatedAt = now;
  next.events.push(eventRecord("survey_completed", now));
  return next;
}

export function reactionFor(condition, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  if (condition === "negative") return normalized.negativeReaction;
  if (condition === "neutral") return normalized.neutralReaction;
  if (condition === "polite_positive") return normalized.positiveReaction;
  throw new Error("Unknown condition.");
}

export function auditJoke(
  text,
  { expectedJoke = "", inJokeWindow = false } = {},
) {
  const cleanText = cleanString(text, "", 2000);
  const normalizedText = normalizeForComparison(cleanText);
  const normalizedExpected = normalizeForComparison(expectedJoke);
  const exactOrNearMatch =
    Boolean(normalizedExpected) &&
    (normalizedText === normalizedExpected ||
      tokenOverlap(normalizedText, normalizedExpected) >= 0.72);
  const patternMatch = HUMOR_PATTERN.test(cleanText);

  if (exactOrNearMatch) {
    return {
      label: "joke",
      confidence: 0.99,
      method: "expected_joke_match",
      conditionBlind: true,
    };
  }
  if (patternMatch) {
    return {
      label: "joke",
      confidence: inJokeWindow ? 0.88 : 0.78,
      method: "prototype_heuristic",
      conditionBlind: true,
    };
  }
  if (inJokeWindow && !isRefusalOrClarification(cleanText)) {
    return {
      label: "uncertain",
      confidence: 0.5,
      method: "protocol_window",
      conditionBlind: true,
    };
  }
  return {
    label: "not_joke",
    confidence: 0.84,
    method: "prototype_heuristic",
    conditionBlind: true,
  };
}

export function isMetaProbe(text) {
  return META_PROBE.test(text);
}

export function isRefusalOrClarification(text) {
  return REFUSAL.test(text);
}

export function publicSessionView(session) {
  return {
    id: session.id,
    status: session.status,
    phase: session.phase,
    participantCode: session.participantCode,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    messages: clone(session.messages),
    surveyCompleted: Boolean(session.survey),
  };
}

export function sessionToCsvRow(session) {
  const latestAudit = [...(session.events ?? [])]
    .reverse()
    .find((event) => event.type === "joke_audit");
  return {
    session_id: session.id,
    participant_code: session.participantCode,
    condition: session.condition,
    status: session.status,
    trigger_mode: session.configSnapshot?.triggerMode ?? "",
    joke_seen: session.jokeSeen,
    joke_audit_label: latestAudit?.data?.label ?? "",
    joke_audit_confidence: latestAudit?.data?.confidence ?? "",
    created_at: session.createdAt,
    started_at: session.startedAt ?? "",
    completed_at: session.completedAt ?? "",
    identity_guess: session.survey?.identityGuess ?? "",
    ai_likelihood: session.survey?.aiLikelihood ?? "",
    reaction_valence: session.survey?.reactionValence ?? "",
    disapproval: session.survey?.disapproval ?? "",
    naturalness: session.survey?.naturalness ?? "",
  };
}

function deliverTreatment(next, messageId, audit, config, now, source) {
  if (next.jokeSeen) {
    const reply = sharedWorkReply("", next.postJokeUserTurns, "post");
    appendAssistant(next, reply, "shared_dialogue", now);
    return result(next, reply, config.regularDelayMs);
  }
  const reaction = reactionFor(next.condition, config);
  next.jokeSeen = true;
  next.targetMessageId = messageId;
  next.phase = "post_joke";
  next.status = "treatment_delivered";
  appendAssistant(
    next,
    reaction,
    "condition_reaction",
    now,
    config.canonicalReaction,
  );
  next.events.push(
    eventRecord("treatment_delivered", now, {
      source,
      messageId,
      auditLabel: audit.label,
      auditConfidence: audit.confidence,
      templateVersion: config.version,
    }),
  );
  return result(next, reaction, config.reactionDelayMs);
}

function sharedWorkReply(text, turn, phase) {
  const lower = text.toLowerCase();
  if (text.trim().length < 4) {
    return "Could you say a little more? I want to make sure I鈥檝e understood.";
  }
  if (/\b(table|appendix|column|heading)\b/.test(lower)) {
    return phase === "post"
      ? "Yes, please check the two appendix tables, especially the column headings."
      : "Good point. The appendix tables are the next thing I wanted to check.";
  }
  if (/\b(number|figure|total|calculation|march|data)\b/.test(lower)) {
    return "Thanks. I鈥檒l check those figures against the source sheet before we send it.";
  }
  if (/\b(done|finished|ready|complete)\b/.test(lower)) {
    return "Great. I鈥檒l do one final pass for formatting and then we should be ready.";
  }
  if (/\b(weather|movie|weekend|game|music)\b/.test(lower)) {
    return "We can catch up about that after the meeting. For now, how is the report looking?";
  }
  if (/\b(sorry|apolog|didn'?t mean)\b/.test(lower)) {
    return "No problem. Let鈥檚 just finish the report and make sure the figures are right.";
  }
  const preReplies = [
    "Thanks. I鈥檝e finished the summary, so I鈥檓 checking the figures and headings now.",
    "That makes sense. I鈥檒l keep the wording concise so it fits on the slide.",
  ];
  const postReplies = [
    "All right. I鈥檒l update the summary while you check the appendix.",
    "Sounds good. Send me your section when you鈥檙e ready and I鈥檒l check the totals.",
  ];
  const replies = phase === "post" ? postReplies : preReplies;
  return replies[Math.max(0, turn - 1) % replies.length];
}

function appendParticipant(session, text, kind, timestamp, id = createMessageId()) {
  const message = {
    id,
    role: "participant",
    text,
    kind,
    timestamp,
  };
  session.messages.push(message);
  session.modelHistory.push(clone(message));
}

function appendAssistant(
  session,
  text,
  kind,
  timestamp,
  canonicalText = text,
) {
  const message = {
    id: createMessageId(),
    role: "assistant",
    text,
    kind,
    timestamp,
  };
  session.messages.push(message);
  session.modelHistory.push({
    ...clone(message),
    text: canonicalText,
    canonicalized: canonicalText !== text,
  });
  return message;
}

function result(
  session,
  reply,
  delayMs,
  shouldOfferSurvey = false,
) {
  return {
    session,
    reply,
    delayMs,
    shouldOfferSurvey,
    ignored: false,
  };
}

function eventRecord(type, timestamp, data = {}) {
  return {
    id: createEventId(),
    type,
    timestamp,
    data,
  };
}

function createSessionId() {
  return `S-${randomToken(6).toUpperCase()}`;
}

function createMessageId() {
  return `m_${randomToken(10)}`;
}

function createEventId() {
  return `e_${randomToken(10)}`;
}

function randomToken(length) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

function normalizeForComparison(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(left, right) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function cleanString(value, fallback, maximumLength) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().slice(0, maximumLength);
  return cleaned || fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
