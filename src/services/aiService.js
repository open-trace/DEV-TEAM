const axios = require("axios");

// Base URL of the data team's RAG service, without any path
const AI_API_BASE_URL = process.env.AI_API_BASE_URL;

// RAG retrieval + generation can be slow, so allow plenty of time.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 120000;

// Feedback/session calls are small control-plane requests, so they should not
// wait anywhere near as long as a full RAG query.
const AI_CONTROL_TIMEOUT_MS = Number(process.env.AI_CONTROL_TIMEOUT_MS) || 10000;

// Each subscription plan has its own query route. The path is what locks the
// plan on the RAG side: a client cannot escalate tier through the request body.
const PLAN_QUERY_PATHS = {
  Free: "/query/free",
  Farmers: "/query/farmers",
  Government: "/query/government",
  NGOs: "/query/ngos",
  Agribusinesses: "/query/agribusinesses",
  Integrated: "/query/integrated",
};

// How long the RAG keeps a conversation session before dropping it.
const AI_SESSION_TTL_MS =
  Number(process.env.AI_SESSION_TTL_SECONDS ?? 86400) * 1000;

// Treat a session as gone slightly before it actually expires, so a request
// sent right on the boundary does not land on a session that just vanished.
const SESSION_EXPIRY_SAFETY_MS = 5 * 60 * 1000;

/**
 * Whether the RAG has likely dropped the session for a conversation whose last
 * activity was at `lastActivityAt`.
 *
 * The RAG gives no signal for an unknown session id - it just answers with no
 * memory of the conversation - so this is a time-based guess rather than a
 * check. When it returns true, send chat_history instead of the session id.
 *
 * @param {Date|string|null} lastActivityAt - Timestamp of the last turn
 * @returns {boolean} True when the session should be considered gone
 */
exports.isSessionLikelyExpired = (lastActivityAt) => {
  if (!lastActivityAt) {
    return true;
  }

  const lastActivityMs = new Date(lastActivityAt).getTime();
  if (Number.isNaN(lastActivityMs)) {
    return true;
  }

  return Date.now() - lastActivityMs > AI_SESSION_TTL_MS - SESSION_EXPIRY_SAFETY_MS;
};

const buildUrl = (path) => {
  if (!AI_API_BASE_URL) {
    throw new Error("AI_API_BASE_URL is not configured");
  }

  return `${AI_API_BASE_URL.replace(/\/+$/, "")}${path}`;
};

/**
 * Resolve the RAG query URL for a subscription plan.
 * Throws on an unknown plan rather than falling back to the generic /query
 * route, because an unrecognised plan means our own data is wrong and the
 * request would be rejected by the RAG's plan_type validation anyway.
 */
const resolveQueryUrl = (planType) => {
  const path = PLAN_QUERY_PATHS[planType];
  if (!path) {
    throw new Error(`Unknown subscription plan: ${planType}`);
  }

  return buildUrl(path);
};

const normalizeTokenUsage = (usage = {}) => {
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
  };
};

/**
 * Log an upstream failure with enough detail to debug it, then map it to the
 * message we are willing to show a user.
 */
const handleRagError = (error, context) => {
  console.error(`AI API Error (${context}):`, error.response?.data || error.message);
  console.error("Full error details:", {
    status: error.response?.status,
    statusText: error.response?.statusText,
    url: error.config?.url,
    data: error.response?.data,
  });

  const status = error.response?.status;

  // 422 means we sent a payload the RAG rejected (bad plan_type/category, or an
  // unexpected field). That is our bug, not the user's.
  if (status === 422) {
    return new Error("AI request was rejected as invalid. Please contact support.");
  }

  // Service unavailable (e.g. cold start / restarting)
  if (status === 503) {
    return new Error("AI service is temporarily unavailable. Please try again in a moment.");
  }

  return new Error("Failed to get AI response");
};

/**
 * Send a question to the data team's RAG service and get an answer.
 *
 * Routes to the plan-scoped endpoint for the user's subscription.
 *
 * Conversation memory is either/or, never both: the RAG stops updating its
 * server-side session as soon as `chat_history` is present. So pass exactly one
 * of `sessionId` (preferred - the RAG summarises the whole conversation itself)
 * or `chatHistory` (fallback for chats older than the session TTL, where the
 * server-side memory is gone). Passing both is a caller bug; `chatHistory`
 * would win and the session would silently stop accumulating turns.
 *
 * @param {object} params
 * @param {string} params.query - The user's question
 * @param {string} params.planType - Subscription plan, selects the RAG route
 * @param {object} params.userProfile - { country, plan_type, category }
 * @param {string|null} [params.sessionId] - Session id (we use the chat id)
 * @param {Array<{role: string, content: string}>|null} [params.chatHistory] - Prior turns
 * @param {string|null} [params.userId] - Our user id, for the RAG's analytics
 * @param {boolean} [params.includeTrace] - Ask the service for debug trace info
 * @returns {object} { answer, citations, acf, artifacts, usage, sessionId,
 *   langfuseTraceId, trace }
 */
exports.askAI = async ({
  query,
  planType,
  userProfile,
  sessionId = null,
  chatHistory = null,
  userId = null,
  includeTrace = false,
} = {}) => {
  const url = resolveQueryUrl(planType);

  if (sessionId && chatHistory) {
    throw new Error("askAI accepts either sessionId or chatHistory, not both");
  }

  try {
    // The RAG rejects unknown fields, so only send what its schema defines.
    const payload = {
      query,
      user_profile: userProfile,
      include_trace: includeTrace,
    };

    // Omitting session_id starts a fresh server-side session; sending
    // chat_history takes over context for this request instead.
    if (chatHistory) {
      payload.chat_history = chatHistory;
    } else if (sessionId) {
      payload.session_id = sessionId;
    }

    if (userId) {
      payload.user_id = userId;
    }

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: AI_TIMEOUT_MS,
    });

    const data = response.data || {};

    // The service can return HTTP 200 with an error in the body. Treat that as a failure.
    if (data.error) {
      const message =
        typeof data.error === "string" ? data.error : "AI service returned an error";
      throw new Error(message);
    }

    return {
      answer: data.answer,
      citations: Array.isArray(data.citations) ? data.citations : [],
      // Confidence signal (band, score, explanation) returned on every answer.
      acf: data.acf ?? null,
      // Downloadable exports, populated on Agribusinesses/Integrated when the
      // user asked for one. Empty for every other plan.
      artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
      usage: normalizeTokenUsage(data.usage),
      sessionId: data.session_id ?? null,
      langfuseTraceId: data.langfuse_trace_id ?? null,
      // Only populated when includeTrace was requested; for debugging why an
      // answer came out the way it did, never for storing or returning to users.
      trace: data.trace ?? null,
    };
  } catch (error) {
    // An error we raised ourselves (the RAG reporting a failure in a 200 body)
    // already carries a useful message, as does a request that never got a
    // reply at all. Only remap real HTTP error responses from the RAG.
    if (!error.response) {
      throw error;
    }

    throw handleRagError(error, "query");
  }
};

/**
 * Record a user's thumbs up/down against the Langfuse trace for an answer.
 *
 * @param {object} params
 * @param {string} params.traceId - langfuseTraceId stored with the answer
 * @param {number} params.score - 1 for thumbs up, 0 for thumbs down
 * @param {string|null} [params.comment] - Optional note (max 500 chars)
 */
exports.submitFeedback = async ({ traceId, score, comment = null }) => {
  try {
    const payload = { trace_id: traceId, score };
    if (comment) {
      payload.comment = comment;
    }

    await axios.post(buildUrl("/feedback"), payload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: AI_CONTROL_TIMEOUT_MS,
    });
  } catch (error) {
    if (!error.response) {
      throw error;
    }

    // Langfuse not configured, or the trace id is unknown/expired upstream.
    if (error.response.status === 503) {
      console.error("AI API Error (feedback):", error.response?.data || error.message);
      throw new Error("Feedback is temporarily unavailable. Please try again later.");
    }

    throw handleRagError(error, "feedback");
  }
};

/**
 * Delete a conversation session from the RAG's server-side memory.
 *
 * Call when a chat is deleted so the conversation does not linger upstream.
 * Best-effort: failures are logged and swallowed, since losing a remote session
 * cleanup should never stop a user deleting their own chat.
 *
 * @param {string} sessionId - Session id (we use the chat id)
 */
exports.deleteSession = async (sessionId) => {
  if (!sessionId) {
    return;
  }

  try {
    await axios.delete(buildUrl(`/session/${encodeURIComponent(sessionId)}`), {
      timeout: AI_CONTROL_TIMEOUT_MS,
    });
  } catch (error) {
    console.error(
      "AI API Error (delete session):",
      error.response?.data || error.message,
    );
  }
};
