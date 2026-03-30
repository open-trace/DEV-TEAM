const promptService = require('../services/promptService');

/**
 * Get all Q&A pairs from user's chat messages
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
