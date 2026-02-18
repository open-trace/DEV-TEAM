const prisma = require('../utils/prismaClient');
const { askAI } = require('./aiService');

/**
 * Create a new prompt by asking AI and saving to database
 * @param {string} userId - User's ID
 * @param {string} question - User's question
 * @returns {object} Created prompt with answer
 */
exports.createPrompt = async (userId, question) => {
  // Call external AI API to get answer
  const answer = await askAI(question);

  // Save question and answer to database
  return prisma.prompt.create({
    data: {
      question,
      answer,
      userId
    }
  });
};

/**
 * Get all prompts for a specific user
 * @param {string} userId - User's ID
 * @returns {array} Array of user's prompts, newest first
 */
exports.getUserPrompts = (userId) => {
  return prisma.prompt.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }  // Newest first
  });
};
