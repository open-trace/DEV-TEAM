const prisma = require('../utils/prismaClient');
const { askAI } = require('./aiService');

/**
 * Get all chats for a user
 * @param {string} userId - User's ID
 * @returns {array} Array of chats
 */
exports.getUserChats = async (userId) => {
  // Fetch all chats for the user, ordered by most recent first
  const chats = await prisma.chat.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      category: true,
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
