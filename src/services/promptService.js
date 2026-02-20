const prisma = require('../utils/prismaClient');

/**
 * Get all Q&A pairs from user's chat messages
 * @param {string} userId - User's ID
 * @returns {array} Array of Q&A pairs extracted from chat messages
 */
exports.getUserPrompts = async (userId) => {
  // Get all user's chats with messages
  const chats = await prisma.chat.findMany({
    where: { userId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' } // Oldest message first
      }
    },
    orderBy: { createdAt: 'desc' } // Newest chat first
  });

  // Extract Q&A pairs from messages
  const prompts = [];

  for (const chat of chats) {
    // Group messages in pairs (user question + assistant answer)
    for (let i = 0; i < chat.messages.length - 1; i += 2) {
      const userMsg = chat.messages[i];
      const assistantMsg = chat.messages[i + 1];

      if (userMsg?.role === 'user' && assistantMsg?.role === 'assistant') {
        prompts.push({
          id: userMsg.id,
          question: userMsg.content,
          answer: assistantMsg.content,
          chatId: chat.id,
          createdAt: userMsg.createdAt
        });
      }
    }
  }

  return prompts;
};
