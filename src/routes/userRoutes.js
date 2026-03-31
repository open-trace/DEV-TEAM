const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const { getProfile, updateProfile, deleteAccount, getSettings, updateSettings } = require('../controllers/userController');

/**
 * @route   GET /api/users/me
 * @desc    Get current user's profile
 * @access  Protected (requires authentication)
 */
router.get('/me', auth, getProfile);

/**
 * @route   PUT /api/users/me
 * @desc    Update current user's profile
 * @access  Protected (requires authentication)
 */
router.put('/me', auth, updateProfile);

/**
 * @route   DELETE /api/users/me
 * @desc    Delete user account (requires password confirmation)
 * @access  Protected (requires authentication)
 */
router.delete('/me', auth, deleteAccount);

/**
 * @route   GET /api/users/settings
 * @desc    Get user settings
 * @access  Protected (requires authentication)
 */
router.get('/settings', auth, getSettings);

/**
 * @route   PUT /api/users/settings
 * @desc    Update user settings
 * @access  Protected (requires authentication)
 */
router.put('/settings', auth, updateSettings);

module.exports = router;
