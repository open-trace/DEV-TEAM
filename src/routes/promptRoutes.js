const router = require('express').Router();
const { askQuestion, getMyPrompts } = require('../controllers/promptController');
const auth = require('../middleware/authMiddleware');

router.post('/ask', auth, askQuestion);
router.get('/', auth, getMyPrompts);

module.exports = router;
