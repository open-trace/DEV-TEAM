const authService = require('../services/authService');
const { isValidEmail, isValidPassword, isValidName } = require('../utils/validators');

/**
 * Get current user's profile
 * @route GET /api/users/me
 * @access Protected
 */
exports.getProfile = (req, res) => {
  // req.user is set by auth middleware
  res.json(req.user);
};

/**
 * Update current user's profile
 * @route PUT /api/users/me
 * @access Protected
 */
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userId = req.user.id;

    // Validate name if provided
    if (name !== undefined && !isValidName(name)) {
      return res.status(400).json({ error: 'Name must be between 2 and 50 characters' });
    }

    // Validate email if provided
    if (email !== undefined && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password if provided
    if (password !== undefined) {
      const passwordValidation = isValidPassword(password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({ error: passwordValidation.message });
      }
    }

    // Update user profile
    const updatedUser = await authService.updateUser(userId, { name, email, password });
    
    if (!updatedUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

/**
 * Delete user account
 * @route DELETE /api/users/me
 * @access Protected
 */
exports.deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user.id;

    // Validate password is provided
    if (!password) {
      return res.status(400).json({ error: 'Password is required to delete account' });
    }

    // Delete account (verifies password first)
    const result = await authService.deleteUser(userId, password);
    
    if (!result.success) {
      return res.status(401).json({ error: result.message });
    }

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};
