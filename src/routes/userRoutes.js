const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const { getProfile } = require('../controllers/userController');

router.get('/me', auth, getProfile);

module.exports = router;
