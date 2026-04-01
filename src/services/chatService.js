const crypto = require('node:crypto');
const prisma = require('../utils/prismaClient');
const { askAI } = require('./aiService');

/**
 * Get all chats for a user
 * @param {string} userId - User's ID
 * @param {boolean} includeArchived - Include archived chats (defaults to true)
 * @returns {array} Array of chats
 */
exports.getUserChats = async (userId, includeArchived = true) => {
  // Build where clause
  const where = { userId };
  if (!includeArchived) {
    where.archived = false; // Only non-archived chats
  }

  // Fetch all chats for the user, ordered by most recent first
  const chats = await prisma.chat.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      category: true,
      archived: true,
      createdAt: true
    }
  });

  return chats;
};

/**
 * Get specific chat with all messages
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Chat with messages
 */
exports.getChatWithMessages = async (chatId, userId) => {
  // Fetch chat with all messages, ensuring it belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Ensures user can only access their own chats
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' } // Oldest messages first
      }
    }
  });

  return chat;
};

/**
 * Send a message in a chat and get AI response
 * @param {string} userId - User's ID
 * @param {string} message - User's message
 * @param {string|undefined} category - Optional category (Government, NGOs, Agribusinesses, Farmers)
 * @returns {object} Chat with messages
 */
exports.sendMessage = async (userId, message, category = null) => {
  // Get AI response
  const aiResponse = await askAI(message);

  // Create a new chat with title and optional category
  const chat = await prisma.chat.create({
    data: {
      userId,
      title: message.substring(0, 50), // Use first 50 characters as title
      category: category || null
    }
  });

  // Create user's message
  const userMessage = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: 'user',
      content: message
    }
  });

  // Create AI's response message
  const assistantMessage = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: 'assistant',
      content: aiResponse
    }
  });

  // Return chat with messages
  return {
    id: chat.id,
    title: chat.title,
    category: chat.category,
    userId: chat.userId,
    createdAt: chat.createdAt,
    messages: [userMessage, assistantMessage]
  };
};

/**
 * Add message to existing chat and get AI response
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @param {string} message - User's message
 * @returns {object} Updated chat with all messages
 */
exports.addMessageToExistingChat = async (chatId, userId, message) => {
  // First, verify the chat exists and belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Security: ensures user owns the chat
    }
  });

  if (!chat) {
    return null; // Chat not found or unauthorized
  }

  // Get AI response
  const aiResponse = await askAI(message);

  // Create user's message
  const userMessage = await prisma.message.create({
    data: {
      chatId,
      role: 'user',
      content: message
    }
  });

  // Create AI's response message
  const assistantMessage = await prisma.message.create({
    data: {
      chatId,
      role: 'assistant',
      content: aiResponse
    }
  });

  // Return chat with all messages
  const updatedChat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  return updatedChat;
};

/**
 * Archive a chat (hides chat without deleting)
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Archived chat
 */
exports.archiveChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Archive the chat
  const archivedChat = await prisma.chat.update({
    where: { id: chatId },
    data: { archived: true }
  });

  return archivedChat;
};

/**
 * Unarchive a chat
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Unarchived chat
 */
exports.unarchiveChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Unarchive the chat
  const unarchivedChat = await prisma.chat.update({
    where: { id: chatId },
    data: { archived: false }
  });

  return unarchivedChat;
};

/**
 * Share a chat with a unique token
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Shared chat with shareToken
 */
exports.shareChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Generate unique share token (using chatId + random string)
  const shareToken = `${chatId.substring(0, 8)}-${crypto.randomBytes(8).toString('hex')}`

  // Share the chat
  const sharedChat = await prisma.chat.update({
    where: { id: chatId },
    data: {
      isShared: true,
      shareToken
    }
  });

  return sharedChat;
};

/**
 * Unshare a chat (revoke public access)
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Unshared chat
 */
exports.unshareChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Unshare the chat
  const unsharedChat = await prisma.chat.update({
    where: { id: chatId },
    data: {
      isShared: false,
      shareToken: null
    }
  });

  return unsharedChat;
};

/**
 * Get a shared chat by token (public access - no authentication required)
 * @param {string} shareToken - Share token
 * @returns {object} Chat with messages (read-only view)
 */
exports.getSharedChat = async (shareToken) => {
  // Fetch chat by shareToken
  const chat = await prisma.chat.findUnique({
    where: { shareToken },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!chat?.isShared) {
    throw new Error('Shared chat not found or no longer shared');
  }

  // Return chat without sensitive data (userId not included in response)
  return {
    id: chat.id,
    title: chat.title,
    category: chat.category,
    createdAt: chat.createdAt,
    messages: chat.messages
  };
};

/**
 * Delete a chat and all its messages
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {boolean} True if deleted, false if not found/unauthorized
 */
exports.deleteChat = async (chatId, userId) => {
  // Verify the chat exists and belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Security: ensures user owns the chat
    }
  });

  if (!chat) {
    return false; // Chat not found or unauthorized
  }

  // Delete the chat (messages will cascade delete automatically)
  await prisma.chat.delete({
    where: { id: chatId }
  });

  return true;
};

/**
 * Update chat title
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @param {string} newTitle - New title for the chat
 * @returns {object|null} Updated chat or null if not found/unauthorized
 */
exports.updateChatTitle = async (chatId, userId, newTitle) => {
  // Verify the chat exists and belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Security: ensure user owns the chat
    }
  });

  if (!chat) {
    return null; // Chat not found or unauthorized
  }

  // Update the chat title
  const updatedChat = await prisma.chat.update({
    where: { id: chatId },
    data: { title: newTitle },
    select: {
      id: true,
      title: true,
      category: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return updatedChat;
};
