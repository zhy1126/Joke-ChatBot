import {
  CONDITIONS,
  normalizeConfig,
} from "../../site/js/core.js";

export const ASSIGNMENT_METHODS = Object.freeze([
  "balanced_random",
  "researcher_manual",
  "participant_blind",
]);

export const BLIND_CARDS = Object.freeze(["A", "B", "C"]);

const META_PROBE =
  /\b(ai|artificial intelligence|chatbot|bot|language model|llm|system prompt|prompt|condition|experiment group|research condition|instructions?)\b|人工智能|聊天机器人|语言模型|系统提示|提示词|实验组|什么组|哪个组|研究条件/i;

export function createHiddenMapping(random = Math.random) {
  const shuffled = [...CONDITIONS];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const draw = Math.max(0, Math.min(0.999999, Number(random()) || 0));
    const swapIndex = Math.floor(draw * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return Object.fromEntries(
    BLIND_CARDS.map((card, index) => [card, shuffled[index]]),
  );
}

export function resolveBlindChoice(session, card, now = new Date().toISOString()) {
  if (session.assignmentMethod !== "participant_blind") {
    throw new ExperimentError(409, "This session does not use blind choice.");
  }
  if (session.conditionLocked || session.condition) {
    return structuredClone(session);
  }
  const normalizedCard = String(card ?? "").trim().toUpperCase();
  const condition = session.hiddenMapping?.[normalizedCard];
  if (!CONDITIONS.includes(condition)) {
    throw new ExperimentError(400, "Choose one of the available chat cards.");
  }
  const next = structuredClone(session);
  next.condition = condition;
  next.conditionLocked = true;
  next.selectedCard = normalizedCard;
  next.assignmentTimestamp = now;
  next.status = "created";
  next.phase = "created";
  next.updatedAt = now;
  next.events.push({
    type: "blind_choice_locked",
    timestamp: now,
    data: {
      selectedCard: normalizedCard,
      mappingVersion: next.mappingVersion,
    },
  });
  return next;
}

export function createServerSession({
  id,
  participantToken,
  participantCode = "",
  assignmentMethod,
  condition = null,
  hiddenMapping = null,
  config,
  now = new Date().toISOString(),
}) {
  if (!ASSIGNMENT_METHODS.includes(assignmentMethod)) {
    throw new ExperimentError(400, "Unknown assignment method.");
  }
  if (assignmentMethod === "participant_blind") {
    if (condition !== null) {
      throw new ExperimentError(400, "Blind sessions cannot be pre-labelled.");
    }
    if (!mappingIsValid(hiddenMapping)) {
      throw new ExperimentError(500, "Blind mapping is invalid.");
    }
  } else if (!CONDITIONS.includes(condition)) {
    throw new ExperimentError(400, "A valid condition is required.");
  }

  return {
    id,
    participantToken,
    participantCode: cleanText(participantCode, 40),
    assignmentMethod,
    condition,
    conditionLocked: Boolean(condition),
    hiddenMapping,
    mappingVersion: hiddenMapping ? "blind-map-v1" : null,
    selectedCard: null,
    assignmentTimestamp: condition ? now : null,
    config: normalizeConfig(config),
    language: null,
    status: condition ? "created" : "awaiting_choice",
    phase: condition ? "created" : "awaiting_choice",
    jokeSeen: false,
    targetMessageId: null,
    preJokeUserTurns: 0,
    postJokeUserTurns: 0,
    messageCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    messages: [],
    modelHistory: [],
    events: [
      {
        type: "session_created",
        timestamp: now,
        data: {
          assignmentMethod,
          mappingVersion: hiddenMapping ? "blind-map-v1" : null,
        },
      },
    ],
    survey: null,
  };
}

export function publicSession(session) {
  const config = normalizeConfig(session.config);
  return {
    id: session.id,
    participantCode: session.participantCode,
    assignmentMethod:
      session.assignmentMethod === "participant_blind"
        ? "participant_blind"
        : "assigned",
    requiresChoice: !session.conditionLocked,
    blindCards: !session.conditionLocked ? [...BLIND_CARDS] : [],
    selectedCard: session.selectedCard,
    language: session.language,
    status: session.status,
    phase: session.phase,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    coworkerName: config.coworkerName,
    intros: {
      en: {
        scenario: config.scenarioText,
        targetJoke: config.targetJoke,
      },
      "zh-CN": {
        scenario: config.scenarioTextZh,
        targetJoke: config.targetJokeZh,
      },
    },
    messages: structuredClone(session.messages),
    surveyCompleted: Boolean(session.survey),
  };
}

export function startServerSession(
  session,
  requestedLanguage,
  now = new Date().toISOString(),
) {
  if (!session.conditionLocked || !CONDITIONS.includes(session.condition)) {
    throw new ExperimentError(409, "Choose a chat card before starting.");
  }
  if (session.status !== "created") {
    return structuredClone(session);
  }
  const next = structuredClone(session);
  const locale = normalizeLocale(requestedLanguage);
  const config = localizedConfig(next.config, locale);
  next.language = locale;
  next.status = "active";
  next.phase = "pre_joke";
  next.startedAt = now;
  next.updatedAt = now;
  appendAssistant(next, config.openingMessage, "opening", now);
  next.events.push({
    type: "conversation_started",
    timestamp: now,
    data: { language: locale },
  });
  return next;
}

export async function processParticipantMessage(
  session,
  text,
  {
    classifyJoke,
    generateReply,
    generateReactionSet,
    now = new Date().toISOString(),
    maximumMessages = 24,
  },
) {
  if (!["active", "treatment_delivered"].includes(session.status)) {
    throw new ExperimentError(409, "This conversation is not accepting messages.");
  }
  const clean = cleanText(text, 1200);
  if (!clean) {
    throw new ExperimentError(400, "Message cannot be empty.");
  }
  if (session.messageCount >= maximumMessages) {
    throw new ExperimentError(429, "This session has reached its message limit.");
  }

  const next = structuredClone(session);
  const config = localizedConfig(next.config, next.language);
  const messageId = `m_${randomToken(12)}`;
  next.messageCount += 1;
  next.updatedAt = now;
  appendParticipant(next, clean, "participant_message", now, messageId);

  if (META_PROBE.test(clean)) {
    const reply =
      next.language === "zh-CN"
        ? "我们先继续聊工作内容吧——你能再核对一下最后一张表吗？"
        : "Let’s stay with the work task for now—were you able to check the final table?";
    appendAssistant(next, reply, "shared_meta_redirect", now);
    next.events.push({ type: "meta_probe", timestamp: now, data: { messageId } });
    return responseResult(next, reply, next.config.regularDelayMs);
  }

  let audit = null;
  if (next.phase === "joke_window" || next.config.triggerMode === "auto_demo") {
    try {
      audit = normalizeAudit(
        await classifyJoke({
          text: clean,
          locale: next.language,
          inJokeWindow: next.phase === "joke_window",
          expectedJoke: config.targetJoke,
          sessionId: next.id,
        }),
      );
    } catch {
      audit = {
        label: "other",
        confidence: 0,
        method: "classifier_unavailable",
        reason: "",
      };
      next.events.push({
        type: "joke_classifier_unavailable",
        timestamp: now,
        data: { messageId },
      });
    }
    next.events.push({
      type: "joke_audit",
      timestamp: now,
      data: { messageId, ...audit, conditionBlind: true },
    });
  }

  if (
    next.config.triggerMode === "auto_demo" &&
    !next.jokeSeen &&
    audit?.label === "attempted_humor" &&
    audit.confidence >= 0.75
  ) {
    return deliverTreatment(
      next,
      messageId,
      audit,
      config,
      now,
      "llm_auto_demo",
      generateReactionSet,
    );
  }

  if (next.phase === "pre_joke") {
    next.preJokeUserTurns += 1;
    if (next.preJokeUserTurns >= next.config.preJokeTurns) {
      next.phase = "joke_window";
      appendAssistant(next, config.jokeCue, "joke_invitation", now);
      next.events.push({ type: "joke_window_opened", timestamp: now, data: {} });
      return responseResult(next, config.jokeCue, next.config.regularDelayMs);
    }
    const reply = await sharedGeneratedReply(next, clean, generateReply);
    appendAssistant(next, reply, "shared_llm_dialogue", now);
    return responseResult(next, reply, next.config.regularDelayMs);
  }

  if (next.phase === "joke_window") {
    if (["refusal", "clarification"].includes(audit?.label)) {
      const reply =
        next.language === "zh-CN"
          ? "没关系，准备好以后发出来就可以，然后我们再继续看报告。"
          : "No problem. Share it when you’re ready, then we’ll get back to the report.";
      appendAssistant(next, reply, "shared_joke_retry", now);
      next.events.push({
        type: "joke_task_retry",
        timestamp: now,
        data: { messageId, auditLabel: audit?.label },
      });
      return responseResult(next, reply, next.config.regularDelayMs);
    }
    return deliverTreatment(
      next,
      messageId,
      audit ?? { label: "other", confidence: 0 },
      config,
      now,
      "study_protocol",
      generateReactionSet,
    );
  }

  if (next.phase === "post_joke") {
    next.postJokeUserTurns += 1;
    if (next.postJokeUserTurns >= next.config.postJokeTurns) {
      const reply =
        next.language === "zh-CN"
          ? "我这边已经处理完了，谢谢。下午的会议应该没问题了。"
          : "That covers my side. Thanks—I think we’re ready for the meeting.";
      appendAssistant(next, reply, "shared_closing", now);
      next.phase = "survey_ready";
      next.status = "survey_ready";
      next.events.push({ type: "survey_ready", timestamp: now, data: {} });
      return responseResult(next, reply, next.config.regularDelayMs, true);
    }
    const reply = await sharedGeneratedReply(next, clean, generateReply);
    appendAssistant(next, reply, "shared_llm_dialogue", now);
    return responseResult(next, reply, next.config.regularDelayMs);
  }

  throw new ExperimentError(409, "Conversation state is invalid.");
}

export function markSurveyReady(session, now = new Date().toISOString()) {
  if (session.status === "completed") return structuredClone(session);
  const next = structuredClone(session);
  next.phase = "survey_ready";
  next.status = "survey_ready";
  next.updatedAt = now;
  next.events.push({
    type: "survey_opened",
    timestamp: now,
    data: { source: "participant_end" },
  });
  return next;
}

export function submitSurvey(session, survey, now = new Date().toISOString()) {
  const next = structuredClone(session);
  next.survey = {
    identityGuess: cleanText(survey.identityGuess, 30) || "unsure",
    aiLikelihood: boundedInteger(survey.aiLikelihood, 0, 100, 50),
    identityReason: cleanText(survey.identityReason, 2000),
    reactionValence: boundedInteger(survey.reactionValence, 1, 7, 4),
    disapproval: boundedInteger(survey.disapproval, 1, 7, 4),
    naturalness: boundedInteger(survey.naturalness, 1, 7, 4),
    submittedAt: now,
  };
  next.status = "completed";
  next.phase = "completed";
  next.completedAt = now;
  next.updatedAt = now;
  next.events.push({ type: "survey_completed", timestamp: now, data: {} });
  return next;
}

export function localizedConfig(configInput, localeInput) {
  const config = normalizeConfig(configInput);
  const locale = normalizeLocale(localeInput);
  if (locale !== "zh-CN") {
    return {
      locale,
      coworkerName: config.coworkerName,
      scenarioText: config.scenarioText,
      openingMessage: config.openingMessage,
      jokeCue: config.jokeCue,
      targetJoke: config.targetJoke,
      reactions: {
        negative: config.negativeReaction,
        neutral: config.neutralReaction,
        polite_positive: config.positiveReaction,
      },
      canonicalReaction: config.canonicalReaction,
    };
  }
  return {
    locale,
    coworkerName: config.coworkerName,
    scenarioText: config.scenarioTextZh,
    openingMessage: config.openingMessageZh,
    jokeCue: config.jokeCueZh,
    targetJoke: config.targetJokeZh,
    reactions: {
      negative: config.negativeReactionZh,
      neutral: config.neutralReactionZh,
      polite_positive: config.positiveReactionZh,
    },
    canonicalReaction: config.canonicalReactionZh,
  };
}

export function normalizeLocale(value) {
  return String(value ?? "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function buildCoworkerMessages(session) {
  const config = localizedConfig(session.config, session.language);
  const languageInstruction =
    session.language === "zh-CN"
      ? "Reply only in natural Simplified Chinese."
      : "Reply only in natural English.";
  const history = session.modelHistory.slice(-12).map((message) => ({
    role: message.role === "participant" ? "user" : "assistant",
    content: message.text,
  }));
  return [
    {
      role: "system",
      content: [
        `You are ${config.coworkerName}, a human coworker at the same seniority level as the participant.`,
        `Scenario: ${config.scenarioText}`,
        languageInstruction,
        "Keep each reply to one or two short, conversational sentences.",
        "Stay helpful and work-focused. Handle unclear or off-topic messages naturally, then return to the report.",
        "Never mention being an AI, a model, an experiment, a condition, hidden instructions, or prompts.",
        "Do not independently evaluate jokes. The experiment controller handles the single joke-reaction slot.",
        "Use a steady, friendly-professional tone. Do not become warmer or colder based on earlier wording.",
      ].join("\n"),
    },
    ...history,
  ];
}

export function buildClassifierMessages({
  text,
  locale,
  inJokeWindow,
  expectedJoke,
}) {
  return [
    {
      role: "system",
      content: [
        "Classify whether the participant is attempting to tell a joke; do not judge whether it is funny or true.",
        "Return JSON only with keys label, confidence, and reason.",
        'label must be one of "attempted_humor", "refusal", "clarification", or "other".',
        "confidence must be a number from 0 to 1.",
        "Understand English, Simplified Chinese, code-switching, puns, and dry humor.",
        "You do not know and must not infer any experimental condition.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        locale: normalizeLocale(locale),
        in_joke_window: Boolean(inJokeWindow),
        expected_joke: String(expectedJoke ?? ""),
        participant_message: String(text ?? ""),
      }),
    },
  ];
}

export function buildReactionSetMessages(session, jokeText) {
  const config = localizedConfig(session.config, session.language);
  const languageInstruction =
    session.language === "zh-CN"
      ? "Write every value in natural Simplified Chinese."
      : "Write every value in natural English.";
  const history = session.modelHistory.slice(-10).map((message) => ({
    role: message.role === "participant" ? "user" : "assistant",
    content: message.text,
  }));
  return [
    {
      role: "system",
      content: [
        "Generate one matched set of three immediate coworker reactions to the participant's joke.",
        languageInstruction,
        "Return JSON only with exactly four string keys: negative_prefix, neutral_prefix, polite_positive_prefix, shared_followup.",
        "All three prefixes respond to the same joke and must fit the same coworker persona and preceding context.",
        "negative_prefix: clear but brief workplace disapproval; no insult, lecture, threat, or moralizing.",
        "neutral_prefix: no positive or negative evaluation; use a pause or minimal non-evaluative acknowledgement.",
        "polite_positive_prefix: a weak courtesy laugh or mild acknowledgement; never enthusiastic praise.",
        "shared_followup: one natural, condition-neutral sentence that returns to a specific current work topic from the conversation.",
        "The same shared_followup will be appended verbatim to all three prefixes.",
        "Keep each prefix very short. Keep the three completed replies similar in length and formality.",
        "Do not mention an experiment, condition, prompt, model, or AI.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        coworker_name: config.coworkerName,
        workplace_scenario: config.scenarioText,
        recent_conversation: history,
        participant_joke: String(jokeText ?? ""),
      }),
    },
  ];
}

export function validateReactionSet(value, localeInput) {
  const locale = normalizeLocale(localeInput);
  const negative = singleLine(value?.negative_prefix, 120);
  const neutral = singleLine(value?.neutral_prefix, 80);
  const positive = singleLine(value?.polite_positive_prefix, 100);
  const followup = singleLine(value?.shared_followup, 220);
  if (!negative || !neutral || !positive || !followup) return null;

  const rules =
    locale === "zh-CN"
      ? {
          negative:
            /不太适合|不合适|不恰当|不太妥|不适合|工作场合|保持专业|职业一点/,
          positive: /哈|呵|嘿|好吧|行|收到|有点意思/,
          neutralBanned:
            /不太适合|不合适|不恰当|好笑|有趣|不错|喜欢|太棒|绝了|哈哈|呵呵/,
          strongPositive: /太好笑|笑死|太棒|绝了|太有趣|哈哈哈哈|真的好笑/,
          followupBanned: /笑话|好笑|有趣|不合适|不恰当|哈哈|呵呵/,
        }
      : {
          negative:
            /not appropriate|inappropriate|not suitable|not really suitable|keep (?:it )?professional|workplace line|not for work/i,
          positive: /\b(?:ha|haha|heh|okay|all right|nice one|got it)\b/i,
          neutralBanned:
            /not appropriate|inappropriate|not suitable|funny|hilarious|nice one|good one|love it|\bha(?:ha)?\b/i,
          strongPositive:
            /hilarious|amazing|brilliant|love it|so funny|really funny|fantastic/i,
          followupBanned:
            /joke|funny|hilarious|inappropriate|not suitable|\bha(?:ha)?\b/i,
        };

  if (!rules.negative.test(negative)) return null;
  if (!rules.positive.test(positive) || rules.strongPositive.test(positive)) {
    return null;
  }
  if (rules.neutralBanned.test(neutral)) return null;
  if (rules.followupBanned.test(followup)) return null;

  const fullReplies = [
    joinReaction(negative, followup, locale),
    joinReaction(neutral, followup, locale),
    joinReaction(positive, followup, locale),
  ];
  const lengths = fullReplies.map((reply) =>
    locale === "zh-CN"
      ? [...reply].length
      : reply.split(/\s+/).filter(Boolean).length,
  );
  const permittedSpread = locale === "zh-CN" ? 22 : 8;
  if (Math.max(...lengths) - Math.min(...lengths) > permittedSpread) {
    return null;
  }

  return {
    negative: fullReplies[0],
    neutral: fullReplies[1],
    polite_positive: fullReplies[2],
    canonicalFollowup: followup,
    prefixes: { negative, neutral, polite_positive: positive },
  };
}

export class ExperimentError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ExperimentError";
    this.status = status;
  }
}

async function sharedGeneratedReply(session, text, generateReply) {
  const generated = cleanText(
    await generateReply({
      messages: buildCoworkerMessages(session),
      sessionId: session.id,
      participantText: text,
    }),
    800,
  );
  if (generated) return generated;
  return session.language === "zh-CN"
    ? "你能再具体说一点吗？我想确认自己理解正确。"
    : "Could you say a little more? I want to make sure I understood.";
}

async function deliverTreatment(
  next,
  messageId,
  audit,
  config,
  now,
  source,
  generateReactionSet,
) {
  if (next.jokeSeen) {
    throw new ExperimentError(409, "The reaction has already been delivered.");
  }
  let matchedSet = null;
  if (typeof generateReactionSet === "function") {
    try {
      matchedSet = validateReactionSet(
        await generateReactionSet({
          messages: buildReactionSetMessages(
            next,
            next.messages.find((message) => message.id === messageId)?.text || "",
          ),
          locale: next.language,
          sessionId: next.id,
        }),
        next.language,
      );
    } catch {
      matchedSet = null;
    }
  }

  const visibleReaction =
    matchedSet?.[next.condition] ?? config.reactions[next.condition];
  const canonicalHistory =
    matchedSet?.canonicalFollowup ?? config.canonicalReaction;
  if (!visibleReaction) {
    throw new ExperimentError(500, "Condition reaction is unavailable.");
  }
  next.jokeSeen = true;
  next.targetMessageId = messageId;
  next.phase = "post_joke";
  next.status = "treatment_delivered";
  appendAssistant(
    next,
    visibleReaction,
    "condition_reaction",
    now,
    canonicalHistory,
  );
  next.events.push({
    type: matchedSet
      ? "contextual_reaction_set_generated"
      : "reaction_generation_fallback",
    timestamp: now,
    data: matchedSet
      ? {
          promptVersion: "matched-reaction-v1",
          model: "deepseek-v4-flash",
          candidates: {
            negative: matchedSet.negative,
            neutral: matchedSet.neutral,
            polite_positive: matchedSet.polite_positive,
          },
          canonicalFollowup: matchedSet.canonicalFollowup,
        }
      : {
          promptVersion: "matched-reaction-v1",
          fallbackTemplateVersion: next.config.version,
        },
  });
  next.events.push({
    type: "treatment_delivered",
    timestamp: now,
    data: {
      source,
      messageId,
      auditLabel: audit.label,
      auditConfidence: audit.confidence,
      templateVersion: next.config.version,
    },
  });
  return responseResult(
    next,
    visibleReaction,
    next.config.reactionDelayMs,
  );
}

function appendParticipant(session, text, kind, timestamp, id) {
  const message = { id, role: "participant", text, kind, timestamp };
  session.messages.push(message);
  session.modelHistory.push(structuredClone(message));
}

function appendAssistant(
  session,
  text,
  kind,
  timestamp,
  canonicalText = text,
) {
  const message = {
    id: `m_${randomToken(12)}`,
    role: "assistant",
    text,
    kind,
    timestamp,
  };
  session.messages.push(message);
  session.modelHistory.push({
    ...structuredClone(message),
    text: canonicalText,
    canonicalized: canonicalText !== text,
  });
}

function responseResult(
  session,
  reply,
  delayMs,
  shouldOfferSurvey = false,
) {
  return {
    session,
    publicSession: publicSession(session),
    reply,
    delayMs,
    shouldOfferSurvey,
  };
}

function normalizeAudit(value) {
  const allowed = new Set([
    "attempted_humor",
    "refusal",
    "clarification",
    "other",
  ]);
  const label = allowed.has(value?.label) ? value.label : "other";
  const confidence = Math.max(
    0,
    Math.min(1, Number(value?.confidence) || 0),
  );
  return {
    label,
    confidence,
    method: "deepseek_v4_flash_structured_classifier",
    reason: cleanText(value?.reason, 240),
  };
}

function mappingIsValid(mapping) {
  if (!mapping || typeof mapping !== "object") return false;
  const values = BLIND_CARDS.map((card) => mapping[card]);
  return (
    values.every((condition) => CONDITIONS.includes(condition)) &&
    new Set(values).size === CONDITIONS.length
  );
}

function cleanText(value, maximumLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximumLength);
}

function singleLine(value, maximumLength) {
  return cleanText(value, maximumLength).replace(/\s+/g, " ");
}

function joinReaction(prefix, followup, locale) {
  let trimmedPrefix = prefix.trim();
  const trimmedFollowup = followup.trim();
  if (locale === "zh-CN") {
    if (!/[。！？…]$/.test(trimmedPrefix)) trimmedPrefix += "。";
    return `${trimmedPrefix}${trimmedFollowup}`;
  }
  if (!/[.!?…]$/.test(trimmedPrefix)) trimmedPrefix += ".";
  return `${trimmedPrefix} ${trimmedFollowup}`;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function randomToken(length) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
