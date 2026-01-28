const promptService = require('../services/promptService');

exports.askQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.user.id;

    const result = await promptService.createPrompt(userId, question);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: 'AI response failed' });
  }
};

exports.getMyPrompts = async (req, res) => {
  const prompts = await promptService.getUserPrompts(req.user.id);
  res.json(prompts);
};
