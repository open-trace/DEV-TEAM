const express = require('express');
const { signup, login, logout } = require('../controllers/authController');
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
 * @route   POST /api/auth/logout
 * @desc    Logout user (invalidate token)
 * @access  Protected
 */
router.post('/logout', auth, logout);

module.exports = router;
