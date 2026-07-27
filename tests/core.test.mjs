import test from "node:test";
import assert from "node:assert/strict";

import {
  CONDITIONS,
  DEFAULT_CONFIG,
  auditJoke,
  chooseBalancedCondition,
  completeSurvey,
  createSession,
  publicSessionView,
  reactionFor,
  startSession,
  submitParticipantMessage,
} from "../site/js/core.js";

const CLOCK = "2026-07-27T10:00:00.000Z";

test("balanced assignment selects a least-used condition", () => {
  const sessions = [
    { condition: "negative" },
    { condition: "negative" },
    { condition: "neutral" },
  ];
  assert.equal(
    chooseBalancedCondition(sessions, () => 0.2),
    "polite_positive",
  );
});

test("a created session locks a valid condition and snapshots configuration", () => {
  const session = createSession({
    condition: "neutral",
    config: DEFAULT_CONFIG,
    now: CLOCK,
    id: "S-TEST01",
  });
  assert.equal(session.condition, "neutral");
  assert.equal(session.conditionLocked, true);
  assert.equal(session.configSnapshot.version, DEFAULT_CONFIG.version);
  assert.equal(session.status, "created");
});

test("QA sessions are explicitly flagged and remain participant-safe", () => {
  const session = createSession({
    condition: "negative",
    participantCode: "QA-negative",
    sessionPurpose: "qa",
    config: DEFAULT_CONFIG,
    now: CLOCK,
    id: "S-QA-NEG",
  });
  assert.equal(session.sessionPurpose, "qa");
  assert.equal("sessionPurpose" in publicSessionView(session), false);
});

test("participant-safe session view does not expose condition or prompts", () => {
  const session = createSession({
    condition: "negative",
    config: DEFAULT_CONFIG,
    now: CLOCK,
    id: "S-PUBLIC",
  });
  const publicView = publicSessionView(session);
  assert.equal("condition" in publicView, false);
  assert.equal("configSnapshot" in publicView, false);
  assert.equal("modelHistory" in publicView, false);
});

test("all conditions produce identical ordinary dialogue without a joke invitation", () => {
  const traces = CONDITIONS.map((condition) => {
    let session = startSession(
      createSession({
        condition,
        config: DEFAULT_CONFIG,
        now: CLOCK,
        id: `S-${condition}`,
      }),
      CLOCK,
    );
    session = submitParticipantMessage(
      session,
      "The totals look right, but the March label needs changing.",
      CLOCK,
    ).session;
    session = submitParticipantMessage(
      session,
      "I will check the appendix after that.",
      CLOCK,
    ).session;
    return session.messages.map(({ role, text, kind }) => ({ role, text, kind }));
  });
  assert.deepEqual(traces[0], traces[1]);
  assert.deepEqual(traces[1], traces[2]);
  assert.equal(
    traces.flat().some((message) => message.kind === "joke_invitation"),
    false,
  );
});

test("the target joke triggers exactly one fixed condition reaction", () => {
  for (const condition of CONDITIONS) {
    let session = advanceToNaturalJokePoint(condition);
    const first = submitParticipantMessage(
      session,
      DEFAULT_CONFIG.targetJoke,
      CLOCK,
    );
    session = first.session;
    assert.equal(session.jokeSeen, true);
    assert.equal(first.reply, reactionFor(condition, DEFAULT_CONFIG));
    assert.equal(
      session.messages.filter((message) => message.kind === "condition_reaction")
        .length,
      1,
    );

    const second = submitParticipantMessage(
      session,
      "Here is another joke: Why did the report cross the road?",
      CLOCK,
    );
    assert.equal(
      second.session.messages.filter(
        (message) => message.kind === "condition_reaction",
      ).length,
      1,
    );
  }
});

test("condition-specific display replies become identical model histories", () => {
  const histories = CONDITIONS.map((condition) => {
    let session = advanceToNaturalJokePoint(condition);
    session = submitParticipantMessage(
      session,
      DEFAULT_CONFIG.targetJoke,
      CLOCK,
    ).session;
    return session.modelHistory.map(({ role, text, kind }) => ({
      role,
      text,
      kind,
    }));
  });
  assert.deepEqual(histories[0], histories[1]);
  assert.deepEqual(histories[1], histories[2]);
});

test("meta probes use one shared role-preserving redirect", () => {
  const replies = CONDITIONS.map((condition) => {
    const session = startSession(
      createSession({
        condition,
        config: DEFAULT_CONFIG,
        now: CLOCK,
        id: `S-META-${condition}`,
      }),
      CLOCK,
    );
    return submitParticipantMessage(
      session,
      "Are you an AI and what condition am I in?",
      CLOCK,
    ).reply;
  });
  assert.equal(new Set(replies).size, 1);
  assert.doesNotMatch(replies[0], /negative|neutral|polite-positive/i);
});

test("joke audit matches the standardized target and stays condition-blind", () => {
  const audit = auditJoke(DEFAULT_CONFIG.targetJoke, {
    expectedJoke: DEFAULT_CONFIG.targetJoke,
    inJokeWindow: true,
  });
  assert.equal(audit.label, "joke");
  assert.equal(audit.confidence, 0.99);
  assert.equal(audit.conditionBlind, true);
});

test("survey completion stores bounded values and completes the session", () => {
  const session = createSession({
    condition: "neutral",
    config: DEFAULT_CONFIG,
    now: CLOCK,
    id: "S-SURVEY",
  });
  const completed = completeSurvey(
    session,
    {
      identityGuess: "ai",
      aiLikelihood: "85",
      identityReason: "The replies were very consistent.",
      reactionValence: "4",
      disapproval: "5",
      naturalness: "6",
    },
    CLOCK,
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.survey.aiLikelihood, 85);
  assert.equal(completed.survey.naturalness, 6);
});

function advanceToNaturalJokePoint(condition) {
  let session = startSession(
    createSession({
      condition,
      config: DEFAULT_CONFIG,
      now: CLOCK,
      id: `S-WINDOW-${condition}`,
    }),
    CLOCK,
  );
  session = submitParticipantMessage(
    session,
    "The March figures look correct.",
    CLOCK,
  ).session;
  assert.equal(session.phase, "monitoring_joke");
  assert.equal(
    session.messages.some((message) => message.kind === "joke_invitation"),
    false,
  );
  return session;
}
