const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const { sendChat, getAllChats, getChatById, addMessageToChat, deleteChat, updateChatTitle } = require('../controllers/chatController');

/**
 * @route   GET /api/chats/
 * @desc    Get all user's chats
 * @access  Protected (requires authentication)
 */
router.get('/', auth, getAllChats);

/**
 * @route   GET /api/chats/:id
 * @desc    Get specific chat with all messages
 * @access  Protected (requires authentication)
 */
router.get('/:id', auth, getChatById);

/**
 * @route   POST /api/chats/
 * @desc    Send a chat message and get AI response
 * @access  Protected (requires authentication)
 */
router.post('/', auth, sendChat);

/**
 * @route   POST /api/chats/:id/messages
 * @desc    Add message to existing chat and get AI response
 * @access  Protected (requires authentication)
 */
router.post('/:id/messages', auth, addMessageToChat);

/**
 * @route   PATCH /api/chats/:id
 * @desc    Update chat title
 * @access  Protected (requires authentication)
 */
router.patch('/:id', auth, updateChatTitle);

/**
 * @route   DELETE /api/chats/:id
 * @desc    Delete a chat
 * @access  Protected (requires authentication)
 */
router.delete('/:id', auth, deleteChat);

module.exports = router;
