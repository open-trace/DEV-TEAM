const prisma = require('../utils/prismaClient');
const { askAI } = require('./aiService');

exports.createPrompt = async (userId, question) => {
  const answer = await askAI(question);

  return prisma.prompt.create({
    data: {
      question,
      answer,
      userId
    }
  });
};

exports.getUserPrompts = (userId) => {
  return prisma.prompt.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
};
