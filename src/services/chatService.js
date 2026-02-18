const prisma = require('../utils/prismaClient');
const { askAI } = require('./aiService');

/**
 * Send a message in a chat and get AI response
 * @param {string} userId - User's ID
 * @param {string} message - User's message
 * @returns {object} Chat with messages
 */
exports.sendMessage = async (userId, message) => {
  // Get AI response
  const aiResponse = await askAI(message);

  // Create a new chat with title (first 50 chars of message)
  const chat = await prisma.chat.create({
    data: {
      userId,
      title: message.substring(0, 50) // Use first 50 characters as title
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
    userId: chat.userId,
    createdAt: chat.createdAt,
    messages: [userMessage, assistantMessage]
  };
};
