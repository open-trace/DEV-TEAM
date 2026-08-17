const chatService = require('../services/chatService');
const subscriptionService = require('../services/subscriptionService');

const { VALID_PERSPECTIVES } = chatService;

/**
 * Check a requested perspective against what the user's plan allows.
 *
 * @param {string|undefined} perspective - Perspective from the request body
 * @param {string} planType - The user's subscription plan
 * @returns {{status: number, error: string}|null} Rejection, or null if allowed
 */
const validatePerspective = (perspective, planType) => {
  if (!perspective) {
    return null; // Not supplied: the service falls back to the plan's category
  }

  // Free and Integrated users can be answered from any perspective
  if (planType === 'Free' || planType === 'Integrated') {
    if (!VALID_PERSPECTIVES.includes(perspective)) {
      return { status: 400, error: 'Invalid perspective' };
    }

    return null;
  }

  // Paid single-perspective plans (Farmers, Government, NGOs, Agribusinesses)
  // can only use their own
  if (planType !== perspective) {
    return {
      status: 403,
      error: `Your ${planType} plan only includes access to the ${planType} perspective. Upgrade to Integrated to access other perspectives.`
    };
  }

  return null;
};

/**
 * Get all user's chats
 * @route GET /api/chats/?includeArchived=false
 * @access Protected
 */
exports.getAllChats = async (req, res) => {
  try {
    // Get includeArchived query param (defaults to true if not specified)
    const includeArchived = req.query.includeArchived !== 'false';

    // Get all chats for the authenticated user
    const chats = await chatService.getUserChats(req.user.id, includeArchived);
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
    const { message, perspective } = req.body;

    // Validate message
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get user's subscription (check active status and plan type)
    const subscription = await subscriptionService.getCurrentSubscription(req.user.id);
    if (!subscription || (subscription.status !== 'active' && subscription.status !== 'past_due')) {
      return res.status(402).json({ error: 'Subscription not active. Please complete payment to access chat.' });
    }

    // Check query limit BEFORE processing request
    const queryLimitCheck = await subscriptionService.checkQueryLimit(req.user.id);
    if (!queryLimitCheck.hasQueries) {
      return res.status(429).json({
        error: queryLimitCheck.message,
        queriesRemaining: queryLimitCheck.queriesRemaining,
        usage: queryLimitCheck.usage
      });
    }

    // If perspective provided, validate based on subscription type
    const perspectiveError = validatePerspective(perspective, subscription.planType);
    if (perspectiveError) {
      return res.status(perspectiveError.status).json({ error: perspectiveError.error });
    }

    // Send message to AI and save chat (category auto-determined from subscription)
    const chat = await chatService.sendMessage(req.user.id, message, perspective);

    // Increment query usage AFTER request succeeds
    const usageResult = await subscriptionService.incrementQueryUsage(req.user.id, chat.tokenUsage, chat.id);
    const { tokenUsage, ...chatResponse } = chat;

    res.status(201).json({
      ...chatResponse,
      usage: usageResult.usage
    });
  } catch (error) {
    if (error.message.toLowerCase().includes('subscription')) {
      return res.status(402).json({ error: error.message }); // 402 Payment Required
    }
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
    const { message, perspective } = req.body;

    // Validate message
    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get user's subscription (check active status and plan type)
    const subscription = await subscriptionService.getCurrentSubscription(req.user.id);
    if (!subscription || (subscription.status !== 'active' && subscription.status !== 'past_due')) {
      return res.status(402).json({ error: 'Subscription not active. Please complete payment to access chat.' });
    }

    // If perspective provided, validate based on subscription type
    const perspectiveError = validatePerspective(perspective, subscription.planType);
    if (perspectiveError) {
      return res.status(perspectiveError.status).json({ error: perspectiveError.error });
    }

    // Check query limit BEFORE processing request
    const queryLimitCheck = await subscriptionService.checkQueryLimit(req.user.id);
    if (!queryLimitCheck.hasQueries) {
      return res.status(429).json({
        error: queryLimitCheck.message,
        queriesRemaining: queryLimitCheck.queriesRemaining,
        usage: queryLimitCheck.usage
      });
    }

    // Add message to chat and get AI response (category auto-determined from subscription)
    const updatedChat = await chatService.addMessageToExistingChat(id, req.user.id, message, perspective);

    if (!updatedChat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Increment query usage AFTER request succeeds
    const usageResult = await subscriptionService.incrementQueryUsage(req.user.id, updatedChat.tokenUsage, updatedChat.id);
    const { tokenUsage, ...chatResponse } = updatedChat;

    res.status(200).json({
      ...chatResponse,
      usage: usageResult.usage
    });
  } catch (error) {
    if (error.message.toLowerCase().includes('subscription')) {
      return res.status(402).json({ error: error.message }); // 402 Payment Required
    }
    console.error('Add message to chat error:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
};

/**
 * Record thumbs up/down on an AI answer
 * @route POST /api/chats/messages/:messageId/feedback
 * @access Protected
 */
exports.submitMessageFeedback = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { score, comment } = req.body;

    // The RAG takes 1.0 for thumbs up and 0.0 for thumbs down, nothing else
    if (score !== 1 && score !== 0) {
      return res.status(400).json({ error: 'Score must be 1 (thumbs up) or 0 (thumbs down)' });
    }

    if (comment !== undefined && comment !== null) {
      if (typeof comment !== 'string') {
        return res.status(400).json({ error: 'Comment must be text' });
      }

      if (comment.length > 500) {
        return res.status(400).json({ error: 'Comment must be 500 characters or less' });
      }
    }

    const feedback = await chatService.submitMessageFeedback(
      messageId,
      req.user.id,
      score,
      comment?.trim() || null
    );

    if (!feedback) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.status(200).json({ message: 'Feedback recorded', feedback });
  } catch (error) {
    if (
      error.message === 'Feedback can only be given on AI answers' ||
      error.message === 'This answer cannot be rated'
    ) {
      return res.status(400).json({ error: error.message });
    }

    // Langfuse unavailable upstream - the rating is not lost, just retryable
    if (error.message.includes('temporarily unavailable')) {
      return res.status(503).json({ error: error.message });
    }

    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
};

/**
 * Download an export attached to an AI answer
 * @route GET /api/chats/messages/:messageId/artifacts/:artifactId/download
 * @access Protected
 */
exports.downloadMessageArtifact = async (req, res) => {
  try {
    const { messageId, artifactId } = req.params;

    const result = await chatService.getMessageArtifact(messageId, artifactId, req.user.id);

    if (!result) {
      return res.status(404).json({ error: 'Artifact not found' });
    }

    if (result.expired) {
      // 410 Gone: the export was real but its download link has lapsed and
      // cannot be renewed. Asking for the export again produces a fresh one.
      return res.status(410).json({
        error: 'This download has expired. Ask for the export again to get a new copy.'
      });
    }

    // Redirect to storage rather than streaming the file through this server
    res.redirect(302, result.artifact.url);
  } catch (error) {
    console.error('Download artifact error:', error);
    res.status(500).json({ error: 'Failed to download artifact' });
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
 * Archive a chat (hide without deleting)
 * @route POST /api/chats/:id/archive
 * @access Protected
 */
exports.archiveChat = async (req, res) => {
  try {
    const { id } = req.params;

    // Archive the chat
    const archivedChat = await chatService.archiveChat(id, req.user.id);

    res.status(200).json({ message: 'Chat archived successfully', chat: archivedChat });
  } catch (error) {
    if (error.message === 'Chat not found or unauthorized') {
      return res.status(404).json({ error: 'Chat not found' });
    }
    console.error('Archive chat error:', error);
    res.status(500).json({ error: 'Failed to archive chat' });
  }
};

/**
 * Unarchive a chat
 * @route POST /api/chats/:id/unarchive
 * @access Protected
 */
exports.unarchiveChat = async (req, res) => {
  try {
    const { id } = req.params;

    // Unarchive the chat
    const unarchivedChat = await chatService.unarchiveChat(id, req.user.id);

    res.status(200).json({ message: 'Chat unarchived successfully', chat: unarchivedChat });
  } catch (error) {
    if (error.message === 'Chat not found or unauthorized') {
      return res.status(404).json({ error: 'Chat not found' });
    }
    console.error('Unarchive chat error:', error);
    res.status(500).json({ error: 'Failed to unarchive chat' });
  }
};

/**
 * Share a chat (generate public link)
 * @route POST /api/chats/:id/share
 * @access Protected
 */
exports.shareChat = async (req, res) => {
  try {
    const { id } = req.params;

    // Share the chat and generate token
    const sharedChat = await chatService.shareChat(id, req.user.id);

    res.status(200).json({
      message: 'Chat shared successfully',
      shareToken: sharedChat.shareToken,
      shareLink: `${process.env.APP_BASE_URL || 'http://localhost:5000'}/api/chats/share/${sharedChat.shareToken}`
    });
  } catch (error) {
    if (error.message === 'Chat not found or unauthorized') {
      return res.status(404).json({ error: 'Chat not found' });
    }
    console.error('Share chat error:', error);
    res.status(500).json({ error: 'Failed to share chat' });
  }
};

/**
 * Unshare a chat (revoke public link)
 * @route POST /api/chats/:id/unshare
 * @access Protected
 */
exports.unshareChat = async (req, res) => {
  try {
    const { id } = req.params;

    // Unshare the chat
    const unsharedChat = await chatService.unshareChat(id, req.user.id);

    res.status(200).json({ message: 'Chat unshared successfully', chat: unsharedChat });
  } catch (error) {
    if (error.message === 'Chat not found or unauthorized') {
      return res.status(404).json({ error: 'Chat not found' });
    }
    console.error('Unshare chat error:', error);
    res.status(500).json({ error: 'Failed to unshare chat' });
  }
};

/**
 * Get a shared chat by token (public access)
 * @route GET /api/chats/share/:shareToken
 * @access Public (no authentication required)
 */
exports.getSharedChat = async (req, res) => {
  try {
    const { shareToken } = req.params;

    // Get the shared chat
    const chat = await chatService.getSharedChat(shareToken);

    res.status(200).json(chat);
  } catch (error) {
    if (error.message === 'Shared chat not found or no longer shared') {
      return res.status(404).json({ error: 'Shared chat not found or no longer shared' });
    }
    console.error('Get shared chat error:', error);
    res.status(500).json({ error: 'Failed to retrieve shared chat' });
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
