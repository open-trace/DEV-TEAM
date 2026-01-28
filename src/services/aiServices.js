const axios = require('axios');

const AI_API_URL = process.env.AI_API_URL;
const AI_API_KEY = process.env.AI_API_KEY;

exports.askAI = async (prompt) => {
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

  return response.data.answer;
};
