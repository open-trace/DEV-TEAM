const { registerUser, loginUser } = require('../services/authService');

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

module.exports = {
  signup,
  login
};
