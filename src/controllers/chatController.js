const chatService = require('../services/chatService');

exports.sendChat = async (req, res) => {
  const { message } = req.body;
  const chat = await chatService.sendMessage(req.user.id, message);
  res.status(201).json(chat);
};
