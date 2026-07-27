import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG } from "../site/js/core.js";
import {
  buildClassifierMessages,
  buildCoworkerMessages,
  buildReactionSetMessages,
  createHiddenMapping,
  createServerSession,
  localizedConfig,
  processParticipantMessage,
  publicSession,
  resolveBlindChoice,
  startServerSession,
  validateReactionSet,
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
  assert.equal("phase" in safe, false);
  assert.equal("assignmentMethod" in safe, false);
  assert.equal(JSON.stringify(safe).includes("not appropriate for work"), false);
});

test("shared coworker prompt respects explicit task closure without expansion", () => {
  const session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "A", CLOCK),
    "zh-CN",
    CLOCK,
  );
  const prompt = buildCoworkerMessages(session)[0].content;
  assert.match(prompt, /latest message has priority/i);
  assert.match(prompt, /there is nothing else to handle/i);
  assert.match(prompt, /Do not propose, imply, or ask about any additional check/i);
  assert.match(prompt, /asking to check other months/i);
});

test("shared coworker prompt anchors referential clarification to the last assistant turn", () => {
  const session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "A", CLOCK),
    "zh-CN",
    CLOCK,
  );
  session.modelHistory.push({
    id: "m_last",
    role: "assistant",
    text: "好的，那就先这样。下午开会时见。",
    kind: "shared_llm_dialogue",
    timestamp: CLOCK,
  });
  const prompt = buildCoworkerMessages(session)[0].content;
  assert.match(
    prompt,
    /Immediately preceding assistant message: "好的，那就先这样。下午开会时见。"/,
  );
  assert.match(prompt, /use only the immediately preceding assistant message/i);
  assert.match(prompt, /Never revive an older topic/i);
  assert.match(prompt, /Speaker and time attribution must be exact/i);
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
      standardizedTask: true,
      expectedJoke: DEFAULT_CONFIG.targetJoke,
    }),
  );
  assert.doesNotMatch(coworkerPrompt, /negative|polite_positive/);
  assert.doesNotMatch(classifierPrompt, /negative|polite_positive/);
  assert.match(coworkerPrompt, /Never initiate humor/);
  assert.match(coworkerPrompt, /ask the participant to tell a joke/);
  assert.match(coworkerPrompt, /do not evaluate it/);
  assert.match(coworkerPrompt, /Treat only facts explicitly stated/);
  assert.match(coworkerPrompt, /Ground the entire reply/);
  assert.match(coworkerPrompt, /ask for clarification without guessing/);
  assert.match(coworkerPrompt, /Do not invent report sections/);
  assert.match(coworkerPrompt, /Do not take ownership/);
  assert.match(classifierPrompt, /there is no joke invitation/);
  assert.match(classifierPrompt, /not an exact-match requirement/);
  assert.match(classifierPrompt, /even when obscure or unfunny/);
});

test("reaction prompt creates all counterfactual conditions from one shared context", () => {
  const session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "A", CLOCK),
    "zh-CN",
    CLOCK,
  );
  const prompt = JSON.stringify(
    buildReactionSetMessages(session, DEFAULT_CONFIG.targetJokeZh),
  );
  assert.match(prompt, /negative_prefix/);
  assert.match(prompt, /neutral_prefix/);
  assert.match(prompt, /polite_positive_prefix/);
  assert.match(prompt, /shared_followup/);
  assert.match(prompt, /下午|会议/);
  assert.match(prompt, /matched counterfactuals/);
  assert.match(prompt, /not told which one will be displayed/);
  assert.match(prompt, /same shared_followup will be appended verbatim/);
  assert.match(prompt, /Do not repeat or explain the joke/);
  assert.doesNotMatch(prompt, /"condition":"negative"/);
});

test("reaction validator accepts matched subtle reactions and rejects strong praise", () => {
  const valid = validateReactionSet(
    {
      negative_prefix: "这个笑话不太适合工作场合。",
      neutral_prefix: "……",
      polite_positive_prefix: "哈哈……",
      shared_followup: "我们接着检查附录中的数字吧。",
    },
    "zh-CN",
  );
  assert.ok(valid);
  assert.equal(
    valid.polite_positive,
    "哈哈……我们接着检查附录中的数字吧。",
  );

  const invalid = validateReactionSet(
    {
      negative_prefix: "这个笑话不太适合工作场合。",
      neutral_prefix: "……",
      polite_positive_prefix: "太好笑了，简直绝了！",
      shared_followup: "我们接着检查附录中的数字吧。",
    },
    "zh-CN",
  );
  assert.equal(invalid, null);
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
  assert.equal(result.session.phase, "monitoring_joke");
});

test("condition-blind detector ignores ordinary and refusal messages before treating humor", async () => {
  let session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "B", CLOCK),
    "zh-CN",
    CLOCK,
  );
  session = (
    await processParticipantMessage(session, "报告已经完成。", {
      now: CLOCK,
      classifyJoke: async () => ({ label: "other", confidence: 0.9 }),
      generateReply: async () => "好的，我们再看一下附录。",
    })
  ).session;
  assert.equal(session.phase, "monitoring_joke");
  assert.equal(session.jokeSeen, false);

  const refusal = await processParticipantMessage(session, "我可以不讲吗？", {
    now: CLOCK,
    classifyJoke: async () => ({ label: "refusal", confidence: 0.96 }),
    generateReply: async () => "没问题，我们继续核对报告。",
  });
  assert.equal(refusal.session.jokeSeen, false);
  assert.equal(refusal.session.phase, "monitoring_joke");

  const treatment = await processParticipantMessage(
    refusal.session,
    "这是一句很冷的中文双关。",
    {
      now: CLOCK,
      classifyJoke: async () => ({
        label: "attempted_humor",
        confidence: 0.95,
      }),
      generateReply: async () => "unused",
    },
  );
  assert.equal(treatment.session.jokeSeen, true);
  assert.equal(treatment.reply, DEFAULT_CONFIG.neutralReactionZh);
});

test("standardized target still triggers when the classifier is unavailable", async () => {
  const session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "A", CLOCK),
    "en",
    CLOCK,
  );
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

test("assigned condition selects one AI-generated contextual candidate", async () => {
  let session = startServerSession(
    resolveBlindChoice(makeBlindSession(), "C", CLOCK),
    "zh-CN",
    CLOCK,
  );
  session = (
    await processParticipantMessage(session, "附录已经整理好了。", {
      now: CLOCK,
      classifyJoke: async () => ({ label: "other", confidence: 0.9 }),
      generateReply: async () => "unused",
    })
  ).session;
  const result = await processParticipantMessage(
    session,
    DEFAULT_CONFIG.targetJokeZh,
    {
      now: CLOCK,
      classifyJoke: async () => ({
        label: "attempted_humor",
        confidence: 0.96,
      }),
      generateReply: async () => "unused",
      generateReactionSet: async () => ({
        negative_prefix: "这个笑话不太适合工作场合。",
        neutral_prefix: "……",
        polite_positive_prefix: "哈哈……",
        shared_followup: "我们接着检查附录中的数字吧。",
      }),
    },
  );
  assert.equal(
    result.reply,
    "哈哈……我们接着检查附录中的数字吧。",
  );
  assert.equal(
    result.session.modelHistory.at(-1).text,
    "我们接着检查附录中的数字吧。",
  );
  const generatedEvent = result.session.events.find(
    (event) => event.type === "contextual_reaction_set_generated",
  );
  assert.equal(generatedEvent.data.candidates.negative.includes("不太适合"), true);
  assert.equal(
    generatedEvent.data.candidates.polite_positive.includes("哈哈"),
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

