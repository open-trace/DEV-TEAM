const { registerUser, loginUser, verifyEmail, resendVerificationEmail, requestPasswordReset, resetUserPassword, socialLoginGoogle } = require('../services/authService');
const { blacklistToken } = require('../utils/tokenUtils');

/**
 * Handle user signup
 * @route POST /api/auth/signup
 */
const signup = async (req, res) => {
  try {
    // Extract data from request body
    const { email, password, name, country } = req.body;

    // Validate required fields
    if (!email || !password || !country) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and country are required'
      });
    }

    // Call service to register user
    const result = await registerUser(email, password, name, country);

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
 * Handle Google sign-in (registers a new user or logs in an existing one)
 * @route POST /api/auth/google
 */
const googleSignIn = async (req, res) => {
  try {
    // Accept either `idToken` or `credential` (Google Identity Services uses `credential`)
    const { idToken, credential } = req.body;
    const token = idToken || credential;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required'
      });
    }

    const result = await socialLoginGoogle(token);

    if (result.success) {
      return res.status(200).json(result);
    }

    return res.status(401).json(result);
  } catch (error) {
    console.error('Google sign-in controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during Google sign-in'
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

/**
 * Handle forgot password request
 * @route POST /api/auth/forgot-password
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const result = await requestPasswordReset(email);

    // Return 200 for security
    return res.status(200).json(result);
  } catch (error) {
    console.error('Forgot password controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
};

/**
 * Handle password reset
 * @route POST /api/auth/reset-password
 */
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Reset token is required'
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password is required'
      });
    }

    const result = await resetUserPassword(token, newPassword);

    if (result.success) {
      return res.status(200).json(result);
    }

    return res.status(400).json(result);
  } catch (error) {
    console.error('Reset password controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
};

module.exports = {
  signup,
  login,
  googleSignIn,
  logout,
  verifyEmailAddress,
  resendVerification,
  forgotPassword,
  resetPassword
};
