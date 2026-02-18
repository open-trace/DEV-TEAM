const router = require('express').Router();
const { askQuestion, getMyPrompts } = require('../controllers/promptController');
const auth = require('../middleware/authMiddleware');

/**
 * @route   POST /api/prompts/ask
 * @desc    Ask AI a question and save the prompt
 * @access  Protected (requires authentication)
 */
router.post('/ask', auth, askQuestion);

/**
 * @route   GET /api/prompts/
 * @desc    Get all prompts for current user
 * @access  Protected (requires authentication)
 */
router.get('/', auth, getMyPrompts);

module.exports = router;
