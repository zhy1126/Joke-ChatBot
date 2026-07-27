const RESEARCHER_KEY = "workchat-lab::researcher-key";

export function readRemoteSettings() {
  const runtimeUrl = globalThis.WORKCHAT_RUNTIME?.apiBaseUrl || "";
  const apiBaseUrl = normalizeApiUrl(runtimeUrl);
  return {
    apiBaseUrl,
    researcherKey: sessionStorage.getItem(RESEARCHER_KEY) || "",
  };
}

export function saveRemoteSettings({ researcherKey }) {
  if (researcherKey) sessionStorage.setItem(RESEARCHER_KEY, researcherKey);
  else sessionStorage.removeItem(RESEARCHER_KEY);
  return {
    apiBaseUrl: normalizeApiUrl(
      globalThis.WORKCHAT_RUNTIME?.apiBaseUrl || "",
    ),
    researcherKey: researcherKey || "",
  };
}

export function clearResearcherKey() {
  sessionStorage.removeItem(RESEARCHER_KEY);
}

export function remoteModeAvailable(view, settings) {
  if (!settings.apiBaseUrl) return false;
  if (view === "participant") return true;
  return Boolean(settings.researcherKey);
}

export function createRemoteApi(settings) {
  const baseUrl = normalizeApiUrl(settings.apiBaseUrl);
  if (!baseUrl) throw new Error("A valid backend URL is required.");

  async function request(path, options = {}, admin = false) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (admin) {
      if (!settings.researcherKey) {
        throw new Error("Enter the researcher access key.");
      }
      headers.set("Authorization", `Bearer ${settings.researcherKey}`);
    }
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
      });
    } catch {
      throw new Error("Could not reach the experiment backend.");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // A structured error below is more useful than a JSON parsing exception.
    }
    if (!response.ok) {
      const error = new Error(
        payload.error || `Backend request failed (${response.status}).`,
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    health: () => request("/api/health"),
    listSessions: () => request("/api/admin/sessions", {}, true),
    createSession: (body) =>
      request(
        "/api/admin/sessions",
        { method: "POST", body },
        true,
      ),
    deleteSession: (id) =>
      request(
        `/api/admin/sessions/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        true,
      ),
    clearSessions: () =>
      request("/api/admin/sessions", { method: "DELETE" }, true),
    exportSessions: () => request("/api/admin/export", {}, true),
    getSession: (token) =>
      request(`/api/sessions/${encodeURIComponent(token)}`),
    chooseCard: (token, card) =>
      request(`/api/sessions/${encodeURIComponent(token)}/choose`, {
        method: "POST",
        body: { card },
      }),
    startSession: (token, language) =>
      request(`/api/sessions/${encodeURIComponent(token)}/start`, {
        method: "POST",
        body: { language },
      }),
    sendMessage: (token, text) =>
      request(`/api/sessions/${encodeURIComponent(token)}/messages`, {
        method: "POST",
        body: { text },
      }),
    endSession: (token) =>
      request(`/api/sessions/${encodeURIComponent(token)}/end`, {
        method: "POST",
        body: {},
      }),
    submitSurvey: (token, survey) =>
      request(`/api/sessions/${encodeURIComponent(token)}/survey`, {
        method: "POST",
        body: survey,
      }),
  };
}

export function normalizeApiUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["https:", "http:"].includes(url.protocol)) return "";
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    ) {
      return "";
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}
