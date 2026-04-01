const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const { sendChat, getAllChats, getChatById, addMessageToChat, deleteChat, updateChatTitle, archiveChat, unarchiveChat, shareChat, unshareChat, getSharedChat } = require('../controllers/chatController');

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
 * @route   POST /api/chats/:id/archive
 * @desc    Archive a chat (hide without deleting)
 * @access  Protected (requires authentication)
 */
router.post('/:id/archive', auth, archiveChat);

/**
 * @route   POST /api/chats/:id/unarchive
 * @desc    Unarchive a chat
 * @access  Protected (requires authentication)
 */
router.post('/:id/unarchive', auth, unarchiveChat);

/**
 * @route   POST /api/chats/:id/share
 * @desc    Share a chat (generate public link)
 * @access  Protected (requires authentication)
 */
router.post('/:id/share', auth, shareChat);

/**
 * @route   POST /api/chats/:id/unshare
 * @desc    Unshare a chat (revoke public link)
 * @access  Protected (requires authentication)
 */
router.post('/:id/unshare', auth, unshareChat);

/**
 * @route   GET /api/chats/share/:shareToken
 * @desc    Get a shared chat by token (public access, no auth needed)
 * @access  Public
 */
router.get('/share/:shareToken', getSharedChat);

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
