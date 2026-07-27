import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG } from "../site/js/core.js";
import {
  buildClassifierMessages,
  buildCoworkerMessages,
  createHiddenMapping,
  createServerSession,
  localizedConfig,
  processParticipantMessage,
  publicSession,
  resolveBlindChoice,
  startServerSession,
} from "../worker/src/experiment.js";

const CLOCK = "2026-07-27T12:00:00.000Z";

test("blind mapping contains every condition exactly once", () => {
  const values = [0.9, 0.1];
  const mapping = createHiddenMapping(() => values.shift() ?? 0.5);
  assert.deepEqual(Object.keys(mapping), ["A", "B", "C"]);
  assert.deepEqual(
    new Set(Object.values(mapping)),
    new Set(["negative", "neutral", "polite_positive"]),
  );
});

test("participant choice resolves and locks a hidden condition", () => {
  const session = makeBlindSession();
  const resolved = resolveBlindChoice(session, "B", CLOCK);
  assert.equal(resolved.condition, "neutral");
  assert.equal(resolved.conditionLocked, true);
  assert.equal(resolved.selectedCard, "B");
  assert.equal(resolved.status, "created");
});

test("participant-safe view never exposes condition, mapping, reactions, or model history", () => {
  const resolved = resolveBlindChoice(makeBlindSession(), "A", CLOCK);
  const safe = publicSession(resolved);
  assert.equal("condition" in safe, false);
  assert.equal("hiddenMapping" in safe, false);
  assert.equal("config" in safe, false);
  assert.equal("modelHistory" in safe, false);
  assert.equal(JSON.stringify(safe).includes("not appropriate for work"), false);
});

test("Chinese sessions use fixed Chinese wording", () => {
  const session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "C", CLOCK),
    "zh-CN",
    CLOCK,
  );
  assert.equal(session.language, "zh-CN");
  assert.match(session.messages[0].text, /下午|会议/);
  assert.equal(
    localizedConfig(DEFAULT_CONFIG, "zh-CN").reactions.polite_positive,
    DEFAULT_CONFIG.positiveReactionZh,
  );
});

test("condition is absent from coworker and classifier prompts", () => {
  const session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "A", CLOCK),
    "en",
    CLOCK,
  );
  const coworkerPrompt = JSON.stringify(buildCoworkerMessages(session));
  const classifierPrompt = JSON.stringify(
    buildClassifierMessages({
      text: DEFAULT_CONFIG.targetJoke,
      locale: "en",
      inJokeWindow: true,
      expectedJoke: DEFAULT_CONFIG.targetJoke,
    }),
  );
  assert.doesNotMatch(coworkerPrompt, /negative|polite_positive/);
  assert.doesNotMatch(classifierPrompt, /negative|polite_positive/);
});

test("DeepSeek-generated ordinary replies are used before the joke", async () => {
  const session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "A", CLOCK),
    "zh-CN",
    CLOCK,
  );
  const result = await processParticipantMessage(
    session,
    "数字已经核对好了。",
    {
      now: CLOCK,
      classifyJoke: async () => ({
        label: "other",
        confidence: 0.9,
      }),
      generateReply: async () => "谢谢，我再检查一下标题。",
    },
  );
  assert.equal(result.reply, "谢谢，我再检查一下标题。");
  assert.equal(result.session.phase, "pre_joke");
});

test("study protocol uses the classifier for refusal but not as a humor gate", async () => {
  let session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "B", CLOCK),
    "zh-CN",
    CLOCK,
  );
  session.config.preJokeTurns = 1;
  session = (
    await processParticipantMessage(session, "报告已经完成。", {
      now: CLOCK,
      classifyJoke: async () => ({ label: "other", confidence: 0.9 }),
      generateReply: async () => "好。",
    })
  ).session;
  assert.equal(session.phase, "joke_window");

  const refusal = await processParticipantMessage(session, "我可以不讲吗？", {
    now: CLOCK,
    classifyJoke: async () => ({ label: "refusal", confidence: 0.96 }),
    generateReply: async () => "unused",
  });
  assert.equal(refusal.session.jokeSeen, false);
  assert.equal(refusal.session.phase, "joke_window");

  const treatment = await processParticipantMessage(
    refusal.session,
    "这是一句很冷的中文双关。",
    {
      now: CLOCK,
      classifyJoke: async () => ({ label: "other", confidence: 0.55 }),
      generateReply: async () => "unused",
    },
  );
  assert.equal(treatment.session.jokeSeen, true);
  assert.equal(treatment.reply, DEFAULT_CONFIG.neutralReactionZh);
});

test("formal staged treatment still works when the audit classifier is unavailable", async () => {
  let session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "A", CLOCK),
    "en",
    CLOCK,
  );
  session.config.preJokeTurns = 1;
  session = (
    await processParticipantMessage(session, "The report is ready.", {
      now: CLOCK,
      classifyJoke: async () => {
        throw new Error("temporary classifier outage");
      },
      generateReply: async () => "unused",
    })
  ).session;
  const result = await processParticipantMessage(
    session,
    DEFAULT_CONFIG.targetJoke,
    {
      now: CLOCK,
      classifyJoke: async () => {
        throw new Error("temporary classifier outage");
      },
      generateReply: async () => "unused",
    },
  );
  assert.equal(result.reply, DEFAULT_CONFIG.negativeReaction);
  assert.equal(result.session.jokeSeen, true);
  assert.equal(
    result.session.events.some(
      (event) => event.type === "joke_classifier_unavailable",
    ),
    true,
  );
});

test("visible condition reactions collapse to the same canonical model history", async () => {
  const histories = [];
  for (const [card, expected] of [
    ["A", DEFAULT_CONFIG.negativeReactionZh],
    ["B", DEFAULT_CONFIG.neutralReactionZh],
    ["C", DEFAULT_CONFIG.positiveReactionZh],
  ]) {
    let session = startServerSession(
      resolveBlindChoice(makeBlindSession(), card, CLOCK),
      "zh-CN",
      CLOCK,
    );
    session.config.preJokeTurns = 1;
    session = (
      await processParticipantMessage(session, "报告已经完成。", {
        now: CLOCK,
        classifyJoke: async () => ({ label: "other", confidence: 0.9 }),
        generateReply: async () => "unused",
      })
    ).session;
    const result = await processParticipantMessage(session, "讲一个笑话。", {
      now: CLOCK,
      classifyJoke: async () => ({
        label: "attempted_humor",
        confidence: 0.9,
      }),
      generateReply: async () => "unused",
    });
    assert.equal(result.reply, expected);
    histories.push(result.session.modelHistory.at(-1).text);
  }
  assert.equal(new Set(histories).size, 1);
  assert.equal(histories[0], DEFAULT_CONFIG.canonicalReactionZh);
});

function makeBlindSession() {
  return createServerSession({
    id: "S-BLIND01",
    participantToken: "opaque-token",
    participantCode: "P001",
    assignmentMethod: "participant_blind",
    hiddenMapping: {
      A: "negative",
      B: "neutral",
      C: "polite_positive",
    },
    config: DEFAULT_CONFIG,
    now: CLOCK,
  });
}
