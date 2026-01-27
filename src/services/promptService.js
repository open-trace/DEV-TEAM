const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { askAI } = require("./aiService");

const createPrompt = async (userId, question) => {
  const answer = await askAI(question);

  return prisma.prompt.create({
    data: {
      question,
      answer,
      userId,
    },
  });
};

const getUserPrompts = async (userId) => {
  return prisma.prompt.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};

module.exports = {
  createPrompt,
  getUserPrompts,
};
