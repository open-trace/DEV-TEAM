const express = require('express');
const { signup, login, logout, verifyEmailAddress, resendVerification } = require('../controllers/authController');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post('/signup', signup);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', login);

/**
 * @route   GET /api/auth/verify-email
 * @desc    Verify user email with token from email link
 * @access  Public
 */
router.get('/verify-email', verifyEmailAddress);

/**
 * @route   POST /api/auth/resend-verification
 * @desc    Resend verification email for unverified users
 * @access  Public
 */
router.post('/resend-verification', resendVerification);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (invalidate token)
 * @access  Protected
 */
router.post('/logout', auth, logout);

module.exports = router;
