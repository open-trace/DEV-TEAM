const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const { sendChat } = require('../controllers/chatController');

/**
 * @route   POST /api/chats/
 * @desc    Send a chat message and get AI response
 * @access  Protected (requires authentication)
 */
router.post('/', auth, sendChat);

module.exports = router;
