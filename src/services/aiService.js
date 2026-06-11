const axios = require("axios");

// RAG service endpoint
const AI_API_URL = process.env.AI_API_URL;

// RAG retrieval + generation can be slow, so allow plenty of time.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 120000;

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
 * Send a question to the data team's RAG service and get an answer.
 *
 * @param {object} params
 * @param {string} params.query - The user's question
 * @param {string|null} [params.sessionId] - Conversation/session id (chat id). The
 *   service echoes this back
 * @param {object|null} [params.userProfile] - { country, plan_type, category }
 * @param {Array<{role: string, content: string}>} [params.chatHistory] - Prior turns
 * @param {boolean} [params.includeTrace] - Ask the service for debug trace info
 * @returns {object} { answer, citations, usage, sessionId }
 */
exports.askAI = async ({
  query,
  sessionId = null,
  userProfile = null,
  chatHistory = [],
  includeTrace = false,
} = {}) => {
  try {
    const payload = {
      query,
      session_id: sessionId,
      user_profile: userProfile,
      chat_history: chatHistory,
      include_trace: includeTrace,
    };

    const response = await axios.post(AI_API_URL, payload, {
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
      usage: normalizeTokenUsage(data.usage),
      sessionId: data.session_id ?? sessionId,
    };
  } catch (error) {
    console.error("AI API Error:", error.response?.data || error.message);
    console.error("Full error details:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      data: error.response?.data,
    });

    // Service unavailable (e.g. cold start / restarting)
    if (error.response?.status === 503) {
      throw new Error(
        "AI service is temporarily unavailable. Please try again in a moment.",
      );
    }

    throw new Error("Failed to get AI response");
  }
};
