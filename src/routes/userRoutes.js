const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const { getProfile } = require('../controllers/userController');

/**
 * @route   GET /api/users/me
 * @desc    Get current user's profile
 * @access  Protected (requires authentication)
 */
router.get('/me', auth, getProfile);

module.exports = router;
