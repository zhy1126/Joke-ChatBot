import {
  ExperimentError,
  buildClassifierMessages,
  createHiddenMapping,
  createServerSession,
  markSurveyReady,
  processParticipantMessage,
  publicSession,
  resolveBlindChoice,
  startServerSession,
  submitSurvey,
} from "./experiment.js";
import {
  CONDITIONS,
  chooseBalancedCondition,
  normalizeConfig,
} from "../../site/js/core.js";

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") {
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }
    if (origin && !cors) {
      return json({ error: "Origin is not allowed." }, 403);
    }

    try {
      const response = await routeRequest(request, env);
      if (cors) {
        for (const [name, value] of Object.entries(cors)) {
          response.headers.set(name, value);
        }
      }
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    } catch (error) {
      const status =
        error instanceof ExperimentError
          ? error.status
          : Number(error?.status) || 500;
      const message =
        status >= 500
          ? "The experiment service could not complete the request."
          : error.message;
      console.error("request_failed", {
        status,
        name: error?.name,
        message: error?.message,
      });
      const response = json({ error: message }, status);
      if (cors) {
        for (const [name, value] of Object.entries(cors)) {
          response.headers.set(name, value);
        }
      }
      return response;
    }
  },
};

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET" && path === "/api/health") {
    return json({
      ok: true,
      provider: "DeepSeek",
      model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
      apiConfigured: Boolean(env.DEEPSEEK_API_KEY),
      databaseConfigured: Boolean(env.DB),
    });
  }

  if (path.startsWith("/api/admin/")) {
    requireAdmin(request, env);
  }

  if (request.method === "POST" && path === "/api/admin/sessions") {
    const body = await readJson(request);
    const session = await createAdminSession(env, body);
    await insertSession(env, session);
    return json({ session: adminSessionView(session) }, 201);
  }

  if (request.method === "GET" && path === "/api/admin/sessions") {
    const sessions = await listSessions(env);
    return json({ sessions: sessions.map(adminSessionView) });
  }

  if (request.method === "DELETE" && path === "/api/admin/sessions") {
    await env.DB.prepare("DELETE FROM sessions").run();
    return json({ ok: true });
  }

  if (request.method === "GET" && path === "/api/admin/export") {
    const sessions = await listSessions(env);
    return json({
      exportedAt: new Date().toISOString(),
      model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
      sessions,
    });
  }

  const adminSessionMatch = path.match(/^\/api\/admin\/sessions\/([^/]+)$/);
  if (
    request.method === "DELETE" &&
    adminSessionMatch
  ) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?")
      .bind(decodeURIComponent(adminSessionMatch[1]))
      .run();
    return json({ ok: true });
  }

  const participantMatch = path.match(
    /^\/api\/sessions\/([^/]+)(?:\/(choose|start|messages|end|survey))?$/,
  );
  if (participantMatch) {
    const token = decodeURIComponent(participantMatch[1]);
    const action = participantMatch[2] || "";
    const session = await getSessionByToken(env, token);
    if (!session) throw new ExperimentError(404, "Session was not found.");

    if (request.method === "GET" && !action) {
      return json({ session: publicSession(session) });
    }

    if (request.method !== "POST") {
      throw new ExperimentError(405, "Method is not allowed.");
    }

    if (action === "choose") {
      const body = await readJson(request);
      const updated = resolveBlindChoice(session, body.card);
      await updateSession(env, updated);
      return json({ session: publicSession(updated) });
    }

    if (action === "start") {
      const body = await readJson(request);
      const updated = startServerSession(session, body.language);
      await updateSession(env, updated);
      return json({ session: publicSession(updated), delayMs: updated.config.regularDelayMs });
    }

    if (action === "messages") {
      const body = await readJson(request);
      const result = await processParticipantMessage(session, body.text, {
        classifyJoke: (input) => classifyJoke(env, input),
        generateReply: (input) => generateCoworkerReply(env, input),
        generateReactionSet: (input) =>
          generateContextualReactionSet(env, input),
        maximumMessages: Number(env.MAX_SESSION_MESSAGES) || 24,
      });
      await updateSession(env, result.session);
      return json({
        session: result.publicSession,
        reply: result.reply,
        delayMs: result.delayMs,
        shouldOfferSurvey: result.shouldOfferSurvey,
      });
    }

    if (action === "end") {
      const updated = markSurveyReady(session);
      await updateSession(env, updated);
      return json({ session: publicSession(updated) });
    }

    if (action === "survey") {
      const body = await readJson(request);
      const updated = submitSurvey(session, body);
      await updateSession(env, updated);
      return json({ session: publicSession(updated) });
    }
  }

  throw new ExperimentError(404, "Endpoint was not found.");
}

async function createAdminSession(env, body) {
  const assignmentMethod = String(
    body.assignmentMethod || "balanced_random",
  );
  const config = normalizeConfig(body.config);
  let condition = null;
  let hiddenMapping = null;

  if (assignmentMethod === "researcher_manual") {
    if (!CONDITIONS.includes(body.condition)) {
      throw new ExperimentError(400, "Choose a valid manual condition.");
    }
    condition = body.condition;
  } else if (assignmentMethod === "balanced_random") {
    const existing = await listSessions(env);
    condition = chooseBalancedCondition(existing, secureRandom);
  } else if (assignmentMethod === "participant_blind") {
    hiddenMapping = createHiddenMapping(secureRandom);
  } else {
    throw new ExperimentError(400, "Unknown assignment method.");
  }

  return createServerSession({
    id: `S-${randomToken(8).toUpperCase()}`,
    participantToken: randomToken(36),
    participantCode: body.participantCode,
    assignmentMethod,
    condition,
    hiddenMapping,
    config,
  });
}

async function classifyJoke(env, input) {
  const content = await callDeepSeek(env, {
    messages: buildClassifierMessages(input),
    maxTokens: 180,
    temperature: 0,
    responseFormat: { type: "json_object" },
    userId: safeUserId(input.sessionId),
  });
  try {
    return JSON.parse(stripCodeFence(content));
  } catch {
    return { label: "other", confidence: 0, reason: "invalid_json" };
  }
}

async function generateCoworkerReply(env, input) {
  return callDeepSeek(env, {
    messages: input.messages,
    maxTokens: 180,
    temperature: 0.45,
    userId: safeUserId(input.sessionId),
  });
}

async function generateContextualReactionSet(env, input) {
  const content = await callDeepSeek(env, {
    messages: input.messages,
    maxTokens: 320,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    userId: safeUserId(input.sessionId),
  });
  try {
    return JSON.parse(stripCodeFence(content));
  } catch {
    return null;
  }
}

async function callDeepSeek(
  env,
  { messages, maxTokens, temperature, responseFormat, userId },
) {
  const apiKey = await resolveSecret(env.DEEPSEEK_API_KEY);
  if (!apiKey) {
    throw new ExperimentError(503, "The language model is not configured.");
  }
  const baseUrl = String(env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const payload = {
    model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    messages,
    stream: false,
    thinking: { type: "disabled" },
    max_tokens: maxTokens,
    temperature,
    user_id: userId,
  };
  if (responseFormat) payload.response_format = responseFormat;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("DeepSeek request timed out"),
    Number(env.DEEPSEEK_TIMEOUT_MS) || 20000,
  );
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") || "unavailable";
    console.error("deepseek_error", {
      status: response.status,
      requestId,
    });
    throw new ExperimentError(502, "The language model request failed.");
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ExperimentError(502, "The language model returned no text.");
  }
  return content.trim();
}

async function resolveSecret(binding) {
  if (typeof binding === "string") return binding.trim();
  if (binding && typeof binding.get === "function") {
    const value = await binding.get();
    return typeof value === "string" ? value.trim() : "";
  }
  return "";
}

async function insertSession(env, session) {
  await env.DB.prepare(
    `INSERT INTO sessions (
      id, participant_token, participant_code, assignment_method,
      condition, status, created_at, updated_at, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      session.id,
      session.participantToken,
      session.participantCode,
      session.assignmentMethod,
      session.condition,
      session.status,
      session.createdAt,
      session.updatedAt,
      JSON.stringify(session),
    )
    .run();
}

async function updateSession(env, session) {
  await env.DB.prepare(
    `UPDATE sessions
     SET condition = ?, status = ?, updated_at = ?, data = ?
     WHERE id = ?`,
  )
    .bind(
      session.condition,
      session.status,
      session.updatedAt,
      JSON.stringify(session),
      session.id,
    )
    .run();
}

async function getSessionByToken(env, token) {
  const row = await env.DB.prepare(
    "SELECT data FROM sessions WHERE participant_token = ?",
  )
    .bind(token)
    .first();
  return parseSessionRow(row);
}

async function listSessions(env) {
  const result = await env.DB.prepare(
    "SELECT data FROM sessions ORDER BY created_at DESC",
  ).all();
  return (result.results || []).map(parseSessionRow).filter(Boolean);
}

function parseSessionRow(row) {
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function adminSessionView(session) {
  return {
    id: session.id,
    participantToken: session.participantToken,
    participantCode: session.participantCode,
    assignmentMethod: session.assignmentMethod,
    condition: session.condition,
    selectedCard: session.selectedCard,
    status: session.status,
    phase: session.phase,
    jokeSeen: session.jokeSeen,
    language: session.language,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    survey: session.survey,
  };
}

function requireAdmin(request, env) {
  if (!env.RESEARCHER_KEY) {
    throw new ExperimentError(503, "Researcher access is not configured.");
  }
  const authorization = request.headers.get("Authorization") || "";
  const submitted = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!submitted || submitted !== env.RESEARCHER_KEY) {
    throw new ExperimentError(401, "Researcher authentication failed.");
  }
}

function corsHeaders(origin, env) {
  if (!origin) return {};
  const allowed = String(
    env.ALLOWED_ORIGINS || "https://zhy1126.github.io",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ExperimentError(415, "Content-Type must be application/json.");
  }
  try {
    return await request.json();
  } catch {
    throw new ExperimentError(400, "Request body must be valid JSON.");
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function stripCodeFence(value) {
  return String(value)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function safeUserId(value) {
  return String(value || "anonymous")
    .replace(/[^a-zA-Z0-9\-_]/g, "_")
    .slice(0, 128);
}

function secureRandom() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 2 ** 32;
}

function randomToken(length) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
