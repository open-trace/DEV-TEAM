const authService = require('../services/authService');
const {
  getUserSettings,
  updateUserSettings,
  setUserCountry,
  getUserProfile,
  completeOnboarding
} = require('../services/userService');
const {
  isValidEmail,
  isValidPassword,
  isValidName,
  isValidOrganization,
  isValidIntendedUsage,
  normalizeProfession
} = require('../utils/validators');

/**
 * Get current user's profile
 * @route GET /api/users/me
 * @access Protected
 */
exports.getProfile = async (req, res) => {
  try {
    // req.user carries only the columns the auth gates need, so read the full
    // profile (including the onboarding fields) here.
    const result = await getUserProfile(req.user.id);

    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }

    res.json(result.user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
};

/**
 * Update current user's profile
 * @route PUT /api/users/me
 * @access Protected
 */
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, password, organization, intendedUsage } = req.body;
    const userId = req.user.id;
    // The frontend labels this field "Role / Profession", so accept either name.
    const profession = req.body.profession !== undefined ? req.body.profession : req.body.role;

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

    // Validate the onboarding fields if provided. Terms acceptance is not
    // editable here - it is a record of what happened, not a preference.
    let canonicalProfession;
    if (profession !== undefined) {
      canonicalProfession = normalizeProfession(profession);
      if (!canonicalProfession) {
        return res.status(400).json({ error: 'A valid role / profession is required' });
      }
    }

    if (intendedUsage !== undefined) {
      const usageValidation = isValidIntendedUsage(intendedUsage);
      if (!usageValidation.isValid) {
        return res.status(400).json({ error: usageValidation.message });
      }
    }

    if (organization !== undefined) {
      const organizationValidation = isValidOrganization(organization);
      if (!organizationValidation.isValid) {
        return res.status(400).json({ error: organizationValidation.message });
      }
    }

    // Update user profile
    const updatedUser = await authService.updateUser(userId, {
      name,
      email,
      password,
      organization,
      profession: canonicalProfession,
      intendedUsage
    });
    
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
    // Password confirms email/password (or linked) accounts; a fresh Google
    // token (idToken/credential) confirms social-only accounts.
    const { password, idToken, credential } = req.body;
    const userId = req.user.id;
    const googleToken = idToken || credential;

    // Require at least one form of confirmation
    if (!password && !googleToken) {
      return res.status(400).json({ error: 'Password or Google confirmation is required to delete account' });
    }

    // Delete account (verifies identity first)
    const result = await authService.deleteUser(userId, { password, idToken: googleToken });

    if (!result.success) {
      return res.status(401).json({ error: result.message });
    }

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);

    // Billing could not be stopped, so the account was deliberately left in place.
    // The user must know it still exists and is still being charged.
    if (error.message.includes('payment provider')) {
      return res.status(503).json({
        error: 'We could not cancel your subscription with our payment provider, so your account has not been deleted and your subscription is still active. Please try again in a few minutes, or contact support.'
      });
    }

    res.status(500).json({ error: 'Failed to delete account' });
  }
};

/**
 * Set current user's country (one-time; used by social-login users)
 * @route PATCH /api/users/country
 * @access Protected
 */
exports.setCountry = async (req, res) => {
  try {
    const { country } = req.body;
    const userId = req.user.id;

    if (!country) {
      return res.status(400).json({ error: 'Country is required' });
    }

    const result = await setUserCountry(userId, country);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Set country error:', error);
    res.status(500).json({ error: 'Failed to set country' });
  }
};

/**
 * Complete onboarding (the form shown after a plan is selected).
 * Accepts organization, role/profession, intendedUsage and the three
 * acknowledgements. Name, email and country are read-only on that form and are
 * deliberately not accepted here.
 * @route POST /api/users/onboarding
 * @access Protected
 */
exports.completeOnboarding = async (req, res) => {
  try {
    const { organization, profession, role, intendedUsage, acknowledgements } = req.body;
    const userId = req.user.id;

    const result = await completeOnboarding(userId, {
      organization,
      profession,
      role,
      intendedUsage,
      acknowledgements
    });

    if (!result.success) {
      if (result.message === 'User not found') {
        return res.status(404).json({ error: result.message });
      }

      // `missing` lists the unchecked acknowledgements so the frontend can
      // highlight the exact boxes rather than showing a generic error.
      return res.status(400).json({
        error: result.message,
        ...(result.missing ? { missing: result.missing } : {})
      });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
};

/**
 * Get user settings
 * @route GET /api/users/settings
 * @access Protected
 */
exports.getSettings = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await getUserSettings(userId);

    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }

    res.status(200).json({
      success: true,
      settings: result.settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
};

/**
 * Update user settings
 * @route PUT /api/users/settings
 * @access Protected
 */
exports.updateSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Validate that at least one setting is provided
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'At least one setting must be provided' });
    }

    const result = await updateUserSettings(userId, updates);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
