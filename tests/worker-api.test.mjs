import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker/src/index.js";
import { DEFAULT_CONFIG } from "../site/js/core.js";

const ORIGIN = "https://zhy1126.github.io";

test("Worker provides a secure Chinese blind-choice conversation flow", async () => {
  const database = new MockD1();
  const deepSeekPayloads = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    deepSeekPayloads.push(payload);
    const systemPrompt = payload.messages?.[0]?.content || "";
    const classifierInput = payload.response_format
      ? JSON.parse(payload.messages?.[1]?.content || "{}")
      : {};
    const content = systemPrompt.includes("matched set")
      ? JSON.stringify({
          negative_prefix: "这个笑话不太适合工作场合。",
          neutral_prefix: "……",
          polite_positive_prefix: "哈哈……",
        })
      : payload.response_format
        ? JSON.stringify({
          label:
            classifierInput.participant_message === DEFAULT_CONFIG.targetJokeZh
              ? "attempted_humor"
              : "other",
          confidence: 0.98,
          reason:
            classifierInput.participant_message === DEFAULT_CONFIG.targetJokeZh
              ? "participant supplied a punchline"
              : "ordinary work message",
        })
        : "好的，我会再核对一下表格标题。";
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "test-request",
        },
      },
    );
  };

  const env = {
    DB: database,
    DEEPSEEK_API_KEY: {
      async get() {
        return "test-only-placeholder";
      },
    },
    RESEARCHER_KEY: "researcher-test-key",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    ALLOWED_ORIGINS: ORIGIN,
  };

  try {
    const created = await callWorker(env, "/api/admin/sessions", {
      method: "POST",
      admin: true,
      body: {
        assignmentMethod: "participant_blind",
        participantCode: "P-中文",
        config: DEFAULT_CONFIG,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.session.condition, null);
    const token = created.body.session.participantToken;

    const initial = await callWorker(env, `/api/sessions/${token}`);
    assert.equal(initial.body.session.requiresChoice, true);
    assert.equal("condition" in initial.body.session, false);

    const chosen = await callWorker(env, `/api/sessions/${token}/choose`, {
      method: "POST",
      body: { card: "B" },
    });
    assert.equal(chosen.body.session.requiresChoice, false);
    assert.equal("condition" in chosen.body.session, false);

    const started = await callWorker(env, `/api/sessions/${token}/start`, {
      method: "POST",
      body: { language: "zh-CN" },
    });
    assert.equal(started.body.session.language, "zh-CN");
    assert.match(started.body.session.messages[0].text, /会议/);

    const first = await callWorker(env, `/api/sessions/${token}/messages`, {
      method: "POST",
      body: { text: "我已经核对了三月份的数据。" },
    });
    assert.equal(first.body.reply, "好的，我会再核对一下表格标题。");

    const second = await callWorker(env, `/api/sessions/${token}/messages`, {
      method: "POST",
      body: { text: "附录也已经完成。" },
    });
    assert.equal(second.body.reply, "好的，明白了。那就先这样。");
    assert.equal(
      second.body.session.messages.at(-1).kind,
      "shared_explicit_closure",
    );
    assert.equal(second.body.session.status, "active");
    assert.equal("phase" in second.body.session, false);
    assert.equal(
      second.body.session.messages.some(
        (message) => message.kind === "joke_invitation",
      ),
      false,
    );

    const treatment = await callWorker(
      env,
      `/api/sessions/${token}/messages`,
      {
        method: "POST",
        body: { text: DEFAULT_CONFIG.targetJokeZh },
      },
    );
    assert.equal(treatment.body.session.status, "treatment_delivered");
    assert.equal(
      [
        "这个笑话不太适合工作场合。那我们先这样，稍后再聊。",
        "……那我们先这样，稍后再聊。",
        "哈哈……那我们先这样，稍后再聊。",
      ].includes(treatment.body.reply),
      true,
    );

    assert.equal(
      deepSeekPayloads.every(
        (payload) => payload.model === "deepseek-v4-flash",
      ),
      true,
    );
    const ordinaryDialogueCalls = deepSeekPayloads.filter((payload) =>
      payload.messages?.[0]?.content?.includes("human coworker"),
    );
    assert.equal(ordinaryDialogueCalls.length >= 1, true);
    assert.equal(
      ordinaryDialogueCalls.every((payload) => payload.temperature === 0),
      true,
    );
    const serializedModelCalls = JSON.stringify(deepSeekPayloads);
    assert.equal(
      serializedModelCalls.includes(DEFAULT_CONFIG.negativeReactionZh),
      false,
    );
    assert.equal(
      serializedModelCalls.includes(DEFAULT_CONFIG.positiveReactionZh),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker rejects an unapproved browser origin", async () => {
  const request = new Request("https://worker.example/api/health", {
    headers: { Origin: "https://attacker.example" },
  });
  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: ORIGIN,
  });
  assert.equal(response.status, 403);
});

test("Worker flags QA sessions for researchers but not participants", async () => {
  const database = new MockD1();
  const env = {
    DB: database,
    RESEARCHER_KEY: "researcher-test-key",
    ALLOWED_ORIGINS: ORIGIN,
  };
  const created = await callWorker(env, "/api/admin/sessions", {
    method: "POST",
    admin: true,
    body: {
      assignmentMethod: "researcher_manual",
      condition: "negative",
      sessionPurpose: "qa",
      participantCode: "QA-negative",
      config: DEFAULT_CONFIG,
    },
  });
  assert.equal(created.body.session.sessionPurpose, "qa");
  const token = created.body.session.participantToken;
  const participant = await callWorker(env, `/api/sessions/${token}`);
  assert.equal("sessionPurpose" in participant.body.session, false);
});

test("public evaluator creates condition-selectable live DeepSeek QA sessions", async () => {
  const database = new MockD1();
  const originalFetch = globalThis.fetch;
  const deepSeekPayloads = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    deepSeekPayloads.push(payload);
    const systemPrompt = payload.messages?.[0]?.content || "";
    const content = systemPrompt.includes("matched set")
      ? JSON.stringify({
          negative_prefix: "Not appropriate for work.",
          neutral_prefix: "All right.",
          polite_positive_prefix: "Heh...",
        })
      : payload.response_format
        ? JSON.stringify({
            label: "attempted_humor",
            confidence: 0.99,
            reason: "clear workplace pun",
          })
        : "Okay, I’ll keep that update in mind.";
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const env = {
    DB: database,
    DEEPSEEK_API_KEY: "test-only-placeholder",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    ALLOWED_ORIGINS: ORIGIN,
  };
  const expected = {
    negative: /not appropriate for work/i,
    neutral: /^All right\./,
    polite_positive: /^Heh\.\.\./,
  };

  try {
    for (const condition of [
      "negative",
      "neutral",
      "polite_positive",
    ]) {
      const created = await callWorker(env, "/api/evaluator/sessions", {
        method: "POST",
        body: { condition, language: "en" },
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.condition, condition);
      assert.equal(created.body.model, "deepseek-v4-flash");
      assert.equal(created.body.session.status, "active");
      assert.equal("condition" in created.body.session, false);
      assert.equal(typeof created.body.participantToken, "string");

      const treatment = await callWorker(
        env,
        `/api/sessions/${created.body.participantToken}/messages`,
        {
          method: "POST",
          body: { text: DEFAULT_CONFIG.targetJoke },
        },
      );
      assert.equal(treatment.status, 200);
      assert.match(treatment.body.reply, expected[condition]);
      assert.equal(treatment.body.session.status, "treatment_delivered");
    }

    const stored = [...database.rows.values()].map((row) =>
      JSON.parse(row.data),
    );
    assert.equal(stored.every((session) => session.sessionPurpose === "qa"), true);
    assert.equal(stored.every((session) => session.participantCode === "PUBLIC-EVALUATOR"), true);
    assert.equal(deepSeekPayloads.length >= 6, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public evaluator rejects invalid conditions and requests without a site origin", async () => {
  const env = {
    DB: new MockD1(),
    ALLOWED_ORIGINS: ORIGIN,
  };
  const invalid = await callWorker(env, "/api/evaluator/sessions", {
    method: "POST",
    body: { condition: "unknown", language: "en" },
  });
  assert.equal(invalid.status, 400);

  const request = new Request(
    "https://worker.example/api/evaluator/sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condition: "negative", language: "en" }),
    },
  );
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 403);
});

test("public evaluator enforces daily client and global usage limits", async () => {
  const clientLimitedEnv = {
    DB: new MockD1(),
    ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_EVALUATOR_CLIENT_DAILY_LIMIT: "1",
    PUBLIC_EVALUATOR_DAILY_LIMIT: "10",
  };
  const first = await callWorker(clientLimitedEnv, "/api/evaluator/sessions", {
    method: "POST",
    body: { condition: "negative", language: "en" },
  });
  assert.equal(first.status, 201);
  const second = await callWorker(clientLimitedEnv, "/api/evaluator/sessions", {
    method: "POST",
    body: { condition: "neutral", language: "en" },
  });
  assert.equal(second.status, 429);

  const globallyLimitedEnv = {
    DB: new MockD1(),
    ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_EVALUATOR_CLIENT_DAILY_LIMIT: "10",
    PUBLIC_EVALUATOR_DAILY_LIMIT: "1",
  };
  const globalFirst = await callWorker(
    globallyLimitedEnv,
    "/api/evaluator/sessions",
    {
      method: "POST",
      body: { condition: "negative", language: "en" },
    },
  );
  assert.equal(globalFirst.status, 201);
  const globalSecond = await callWorker(
    globallyLimitedEnv,
    "/api/evaluator/sessions",
    {
      method: "POST",
      body: { condition: "neutral", language: "en" },
    },
  );
  assert.equal(globalSecond.status, 429);
});

async function callWorker(
  env,
  path,
  { method = "GET", body, admin = false } = {},
) {
  const headers = new Headers({ Origin: ORIGIN });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (admin) headers.set("Authorization", `Bearer ${env.RESEARCHER_KEY}`);
  const request = new Request(`https://worker.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await worker.fetch(request, env);
  return {
    status: response.status,
    body: await response.json(),
  };
}

class MockD1 {
  constructor() {
    this.rows = new Map();
  }

  prepare(sql) {
    const database = this;
    const compact = sql.replace(/\s+/g, " ").trim();
    return {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async run() {
        if (compact.startsWith("INSERT INTO sessions")) {
          const [
            id,
            participantToken,
            participantCode,
            assignmentMethod,
            condition,
            status,
            createdAt,
            updatedAt,
            data,
          ] = this.values;
          database.rows.set(id, {
            id,
            participant_token: participantToken,
            participant_code: participantCode,
            assignment_method: assignmentMethod,
            condition,
            status,
            created_at: createdAt,
            updated_at: updatedAt,
            data,
          });
        } else if (compact.startsWith("UPDATE sessions")) {
          const [condition, status, updatedAt, data, id] = this.values;
          const row = database.rows.get(id);
          Object.assign(row, {
            condition,
            status,
            updated_at: updatedAt,
            data,
          });
        } else if (compact === "DELETE FROM sessions") {
          database.rows.clear();
        } else if (compact.startsWith("DELETE FROM sessions WHERE id")) {
          database.rows.delete(this.values[0]);
        } else {
          throw new Error(`Unsupported run query: ${compact}`);
        }
        return { success: true };
      },
      async first() {
        if (compact.includes("WHERE participant_token = ?")) {
          const row = [...database.rows.values()].find(
            (candidate) => candidate.participant_token === this.values[0],
          );
          return row ? { data: row.data } : null;
        }
        throw new Error(`Unsupported first query: ${compact}`);
      },
      async all() {
        if (compact.startsWith("SELECT data FROM sessions")) {
          return {
            results: [...database.rows.values()]
              .sort((left, right) =>
                right.created_at.localeCompare(left.created_at),
              )
              .map((row) => ({ data: row.data })),
          };
        }
        throw new Error(`Unsupported all query: ${compact}`);
      },
    };
  }
}
