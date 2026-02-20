const chatService = require('../services/chatService');

/**
 * Get all user's chats
 * @route GET /api/chats/
 * @access Protected
 */
exports.getAllChats = async (req, res) => {
  try {
    // Get all chats for the authenticated user
    const chats = await chatService.getUserChats(req.user.id);
    res.status(200).json(chats);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to retrieve chats' });
  }
};

/**
 * Get specific chat by ID with all messages
 * @route GET /api/chats/:id
 * @access Protected
 */
exports.getChatById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get chat with messages
    const chat = await chatService.getChatWithMessages(id, req.user.id);

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.status(200).json(chat);
  } catch (error) {
    console.error('Get chat by ID error:', error);
    res.status(500).json({ error: 'Failed to retrieve chat' });
  }
};

/**
 * Send a chat message and get AI response
 * @route POST /api/chats/
 * @access Protected
 */
exports.sendChat = async (req, res) => {
  try {
    const { message, category } = req.body;

    // Validate message
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Validate category if provided (optional)
    const validCategories = ['Government', 'NGOs', 'Agribusinesses', 'Farmers'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    // Send message to AI and save chat
    const chat = await chatService.sendMessage(req.user.id, message, category);
    res.status(201).json(chat);
  } catch (error) {
    console.error('Send chat error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

/**
 * Add message to existing chat
 * @route POST /api/chats/:id/messages
 * @access Protected
 */
exports.addMessageToChat = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Validate message
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Add message to chat and get AI response
    const updatedChat = await chatService.addMessageToExistingChat(id, req.user.id, message);

    if (!updatedChat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.status(200).json(updatedChat);
  } catch (error) {
    console.error('Add message to chat error:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
};

/**
 * Update chat title
 * @route PATCH /api/chats/:id
 * @access Protected
 */
exports.updateChatTitle = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    // Validate title
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (title.trim().length > 100) {
      return res.status(400).json({ error: 'Title must be 100 characters or less' });
    }

    // Update chat title
    const updatedChat = await chatService.updateChatTitle(id, req.user.id, title.trim());
    
    if (!updatedChat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.status(200).json(updatedChat);
  } catch (error) {
    console.error('Update chat title error:', error);
    res.status(500).json({ error: 'Failed to update chat title' });
  }
};

/**
 * Delete a chat
 * @route DELETE /api/chats/:id
 * @access Protected
 */
exports.deleteChat = async (req, res) => {
  try {
    const { id } = req.params;

    // Delete chat (messages will cascade delete)
    const deleted = await chatService.deleteChat(id, req.user.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.status(200).json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
};