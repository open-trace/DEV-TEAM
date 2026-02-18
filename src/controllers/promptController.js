const promptService = require('../services/promptService');

/**
 * Ask AI a question and save the prompt
 * @route POST /api/prompts/ask
 * @access Protected
 */
exports.askQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.user.id;

    // Validate question
    if (!question || !question.trim()) {
      return res.status(400).json({ message: 'Question is required' });
    }

    // Call AI and save prompt to database
    const result = await promptService.createPrompt(userId, question);
    res.status(201).json(result);
  } catch (err) {
    console.error('Ask question error:', err);
    res.status(500).json({ message: 'AI response failed' });
  }
};

/**
 * Get all prompts for current user
 * @route GET /api/prompts/
 * @access Protected
 */
exports.getMyPrompts = async (req, res) => {
  try {
    const prompts = await promptService.getUserPrompts(req.user.id);
    res.json(prompts);
  } catch (err) {
    console.error('Get prompts error:', err);
    res.status(500).json({ message: 'Failed to fetch prompts' });
  }
};
