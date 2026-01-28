const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const { sendChat } = require('../controllers/chatController');

router.post('/', auth, sendChat);

module.exports = router;
