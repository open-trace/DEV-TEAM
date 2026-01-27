const {
  createPrompt,
  getUserPrompts,
} = require("../services/promptService");

const askQuestion = async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ message: "Question is required" });
    }

    const prompt = await createPrompt(req.user.id, question);

    res.status(201).json({
      question: prompt.question,
      answer: prompt.answer,
      createdAt: prompt.createdAt,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to process question" });
  }
};

const getHistory = async (req, res) => {
  try {
    const prompts = await getUserPrompts(req.user.id);
    res.json(prompts);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch history" });
  }
};

module.exports = {
  askQuestion,
  getHistory,
};
