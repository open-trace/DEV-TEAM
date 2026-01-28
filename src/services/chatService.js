const prisma = require('../utils/prismaClient');
const { askAI } = require('./aiService');

exports.sendMessage = async (userId, message) => {
  const response = await askAI(message);

  return prisma.chat.create({
    data: {
      message,
      response,
      userId
    }
  });
};
