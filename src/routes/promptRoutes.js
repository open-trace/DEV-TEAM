const router = require('express').Router();
const { getMyPrompts } = require('../controllers/promptController');
const auth = require('../middleware/authMiddleware');

/**
 * @route   GET /api/prompts/
 * @desc    Get all Q&A pairs from user's chat messages
 * @access  Protected (requires authentication)
 */
router.get('/', auth, getMyPrompts);

module.exports = router;
