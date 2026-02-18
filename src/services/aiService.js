const axios = require('axios');

// Get AI API configuration from environment variables
const AI_API_URL = process.env.AI_API_URL;
const AI_API_KEY = process.env.AI_API_KEY;

/**
 * Send a question to external AI API and get answer
 * @param {string} prompt - The question to ask the AI
 * @returns {string} AI-generated answer
 */
exports.askAI = async (prompt) => {
  // MOCK MODE: Return a dummy response for testing
  if (!AI_API_URL || !AI_API_KEY || AI_API_URL === 'mock' || AI_API_URL === 'test') {
    console.log('Using mock AI response (AI API not configured)');
    return `This is a mock AI response to your question: "${prompt}". In production, this would be replaced with actual AI-generated content from your configured AI service.`;
  }

  try {
    // Make POST request to AI API
    const response = await axios.post(
      AI_API_URL,
      { prompt },
      {
        headers: {
          Authorization: `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract and return the answer from response
    return response.data.answer;
  } catch (error) {
    console.error('AI API Error:', error.response?.data || error.message);
    throw new Error('Failed to get AI response');
  }
};
