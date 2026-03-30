const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

// In-memory token blacklist (use Redis in production)
const tokenBlacklist = new Set();

/**
 * Generate JWT token for user authentication
 * @param {string} userId - The user's unique identifier
 * @returns {string} JWT token
 */
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE }
  );
};

/**
 * Verify JWT token and return decoded payload
 * @param {string} token - JWT token to verify
 * @returns {object || null} Decoded token payload or null if invalid
 */
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    // Token is invalid or expired - return null
    console.error('Token verification failed:', error.message);
    return null;
  }
};

/**
 * Add token to blacklist (logout)
 * @param {string} token - Token to blacklist
 */
const blacklistToken = (token) => {
  tokenBlacklist.add(token);
};

/**
 * Check if token is blacklisted
 * @param {string} token - Token to check
 * @returns {boolean} True if blacklisted
 */
const isTokenBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

/**
 * Generate a secure random token for email verification
 * @returns {string} Random hex token (64 characters)
 */
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Get expiry date for verification token (24 hours from now)
 * @returns {Date} Expiry datetime
 */
const getVerificationTokenExpiry = () => {
  const now = new Date();
  now.setHours(now.getHours() + 24);
  return now;
};

module.exports = {
  generateToken,
  verifyToken,
  blacklistToken,
  isTokenBlacklisted,
  generateVerificationToken,
  getVerificationTokenExpiry
};
