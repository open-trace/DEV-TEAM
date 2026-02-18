const chatService = require('../services/chatService');

/**
 * Send a chat message and get AI response
 * @route POST /api/chats/
 * @access Protected
 */
exports.sendChat = async (req, res) => {
  try {
    const { message } = req.body;

    // Validate message
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Send message to AI and save chat
    const chat = await chatService.sendMessage(req.user.id, message);
    res.status(201).json(chat);
  } catch (error) {
    console.error('Send chat error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
