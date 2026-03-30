const { registerUser, loginUser, verifyEmail, resendVerificationEmail } = require('../services/authService');
const { blacklistToken } = require('../utils/tokenUtils');

/**
 * Handle user signup
 * @route POST /api/auth/signup
 */
const signup = async (req, res) => {
  try {
    // Extract data from request body
    const { email, password, name } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Call service to register user
    const result = await registerUser(email, password, name);

    // Send appropriate response based on result
    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }

  } catch (error) {
    console.error('Signup controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during signup'
    });
  }
};

/**
 * Handle user login
 * @route POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    // Extract data from request body
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Call service to login user
    const result = await loginUser(email, password);

    // Send appropriate response based on result
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(401).json(result);
    }

  } catch (error) {
    console.error('Login controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

/**
 * Handle user logout
 * @route POST /api/auth/logout
 */
const logout = async (req, res) => {
  try {
    // Get token from middleware
    const token = req.token; 

    // Add token to blacklist
    blacklistToken(token);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
};

/**
 * Handle email verification
 * @route GET /api/auth/verify-email?token=...
 */
const verifyEmailAddress = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    const result = await verifyEmail(token);

    if (result.success) {
      return res.status(200).json(result);
    }

    return res.status(400).json(result);
  } catch (error) {
    console.error('Verify email controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during email verification'
    });
  }
};

/**
 * Handle resend verification email
 * @route POST /api/auth/resend-verification
 */
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const result = await resendVerificationEmail(email);

    if (result.success) {
      return res.status(200).json(result);
    }

    return res.status(400).json(result);
  } catch (error) {
    console.error('Resend verification controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during resend verification'
    });
  }
};

module.exports = {
  signup,
  login,
  logout,
  verifyEmailAddress,
  resendVerification
};
