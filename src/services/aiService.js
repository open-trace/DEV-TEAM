const axios = require("axios");

// Get AI API configuration from environment variables
const AI_API_URL = process.env.AI_API_URL;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL_NAME = process.env.AI_MODEL_NAME;

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
 * Send a question to external AI API and get answer
 * @param {string} prompt - The question to ask the AI
 * @param {string|null} category - Optional category/perspective (Government, NGOs, Agribusinesses, Farmers, Integrated)
 * @returns {object} AI-generated answer and token usage
 */
exports.askAI = async (prompt, category = null) => {
  try {
    // Build messages array - include system message with category if provided
    const messages = [];
    if (category) {
      messages.push({
        role: "system",
        content: `You are responding from the perspective of: ${category}. Tailor your response accordingly.`
      });
    }
    messages.push({
      role: "user",
      content: prompt
    });

    // POST request to Hugging Face Router API (OpenAI-compatible format)
    const response = await axios.post(
      AI_API_URL,
      {
        model: AI_MODEL_NAME,
        messages,
        max_tokens: 500,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${AI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 seconds for larger model
      },
    );

    // OpenAI-compatible response
    // Response format: {choices: [{message: {content: "answer"}}]}
    const answer = response.data.choices[0].message.content;
    const usage = normalizeTokenUsage(response.data.usage);

    return {
      answer,
      usage,
    };
  } catch (error) {
    console.error("AI API Error:", error.response?.data || error.message);
    console.error("Full error details:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      data: error.response?.data
    });

    // Handle model loading (common on first request)
    if (error.response?.status === 503) {
      throw new Error(
        "AI model is loading. Please wait 20-30 seconds and try again.",
      );
    }

    throw new Error("Failed to get AI response");
  }
};
