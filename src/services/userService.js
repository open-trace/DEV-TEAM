const { PrismaClient } = require('@prisma/client');
const { REQUIRED_ACKNOWLEDGEMENTS } = require('../utils/onboardingOptions');
const {
  normalizeCountry,
  normalizeProfession,
  isValidOrganization,
  isValidIntendedUsage,
  validateAcknowledgements
} = require('../utils/validators');

const prisma = new PrismaClient();

/**
 * Default settings for new users
 */
const defaultSettings = {
  theme: 'light',
  notifications: true,
  chatHistoryEnabled: true,
  language: 'en',
  modelTemperature: 0.7,
  exportFormat: 'json'
};

/**
 * Get user settings
 * @param {string} userId - User's ID
 * @returns {object} User settings
 */
const getUserSettings = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        settings: true
      }
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // If settings is null, initialize with defaults and save to database
    if (!user.settings) {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { settings: defaultSettings },
        select: { settings: true }
      });
      return {
        success: true,
        settings: updatedUser.settings
      };
    }
    
    return {
      success: true,
      settings: user.settings
    };
  } catch (error) {
    console.error('Get settings error:', error);
    return { success: false, message: 'Failed to retrieve settings' };
  }
};

/**
 * Update user settings (merge with existing settings)
 * @param {string} userId - User's ID
 * @param {object} updates - Settings to update
 * @returns {object} Updated settings
 */
const updateUserSettings = async (userId, updates) => {
  try {
    // Get current user settings
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true }
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Merge new settings with existing ones
    const currentSettings = user.settings || {};
    const mergedSettings = {
      ...currentSettings,
      ...updates
    };

    // Validate settings values
    if (mergedSettings.theme && !['light', 'dark'].includes(mergedSettings.theme)) {
      return { success: false, message: 'Invalid theme value. Must be light or dark' };
    }

    if (mergedSettings.notifications !== undefined && typeof mergedSettings.notifications !== 'boolean') {
      return { success: false, message: 'notifications must be true or false' };
    }

    if (mergedSettings.chatHistoryEnabled !== undefined && typeof mergedSettings.chatHistoryEnabled !== 'boolean') {
      return { success: false, message: 'chatHistoryEnabled must be true or false' };
    }

    if (mergedSettings.language && !['en', 'es', 'fr', 'de', 'pt', 'zh'].includes(mergedSettings.language)) {
      return { success: false, message: 'Invalid language. Supported: en, es, fr, de, pt, zh' };
    }

    if (mergedSettings.modelTemperature !== undefined) {
      const temp = Number(mergedSettings.modelTemperature);
      if (Number.isNaN(temp) || temp < 0 || temp > 1) {
        return { success: false, message: 'modelTemperature must be a number between 0 and 1' };
      }
      mergedSettings.modelTemperature = temp;
    }

    if (mergedSettings.exportFormat && !['json', 'pdf', 'csv'].includes(mergedSettings.exportFormat)) {
      return { success: false, message: 'Invalid exportFormat. Must be json, pdf, or csv' };
    }

    // Update user settings in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { settings: mergedSettings },
      select: {
        id: true,
        settings: true
      }
    });

    return {
      success: true,
      message: 'Settings updated successfully',
      settings: updatedUser.settings
    };
  } catch (error) {
    console.error('Update settings error:', error);
    return { success: false, message: 'Failed to update settings' };
  }
};

/**
 * Set the user's country. Country is set once (typically by social-login users
 * whose country is null after sign-in) and can never be changed afterwards.
 * @param {string} userId - User's ID
 * @param {string} country - Country name or ISO code to set
 * @returns {object} { success, message, user }
 */
const setUserCountry = async (userId, country) => {
  try {
    // Validate/normalise the country against the recognised ISO list
    const canonicalCountry = normalizeCountry(country);
    if (!canonicalCountry) {
      return { success: false, message: 'A valid country is required' };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, country: true }
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Enforce "set once, never updated"
    if (user.country) {
      return { success: false, message: 'Country is already set and cannot be changed' };
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { country: canonicalCountry },
      select: {
        id: true,
        email: true,
        name: true,
        country: true,
        createdAt: true
      }
    });

    return {
      success: true,
      message: 'Country set successfully',
      user: updatedUser
    };
  } catch (error) {
    console.error('Set country error:', error);
    return { success: false, message: 'Failed to set country' };
  }
};

/**
 * Fields returned to the client after onboarding. Kept in one place so the
 * onboarding response and the profile response cannot drift apart.
 */
const onboardingSelect = {
  id: true,
  email: true,
  name: true,
  country: true,
  organization: true,
  profession: true,
  intendedUsage: true,
  termsAcceptedAt: true,
  acknowledgements: true
};

/**
 * Get a user's full profile, including the onboarding fields.
 *
 * The auth middleware deliberately selects only the few columns its gates need,
 * so it stays cheap on every authenticated request. This is the fuller read,
 * done once when the profile is actually asked for.
 *
 * @param {string} userId - User's ID
 * @returns {object} { success, message, user }
 */
const getUserProfile = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: onboardingSelect
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    return { success: true, user };
  } catch (error) {
    console.error('Get profile error:', error);
    return { success: false, message: 'Failed to retrieve profile' };
  }
};

/**
 * Complete a user's onboarding (the form shown after a plan is selected).
 *
 * Name, email and country are captured at registration and shown read-only on
 * that page, so they are deliberately not accepted here - onboarding cannot be
 * used to change a verified email or an already-set country.
 *
 * Safe to call more than once (a retried or double-submitted form): the profile
 * fields are updated, but the original acceptance timestamp is kept, since that
 * is the moment consent was actually first given.
 *
 * @param {string} userId - User's ID
 * @param {object} data - { organization, profession, intendedUsage, acknowledgements }
 * @returns {object} { success, message, user }
 */
const completeOnboarding = async (userId, data = {}) => {
  try {
    const { organization, intendedUsage, acknowledgements } = data;
    // The frontend labels this field "Role / Profession", so accept either name.
    const profession = data.profession !== undefined ? data.profession : data.role;

    // Role / Profession - required, and must be one of the dropdown options
    const canonicalProfession = normalizeProfession(profession);
    if (!canonicalProfession) {
      return { success: false, message: 'A valid role / profession is required' };
    }

    // Intended Usage - required
    const usageValidation = isValidIntendedUsage(intendedUsage);
    if (!usageValidation.isValid) {
      return { success: false, message: usageValidation.message };
    }

    // Organization / Company Name - optional
    const organizationValidation = isValidOrganization(organization);
    if (!organizationValidation.isValid) {
      return { success: false, message: organizationValidation.message };
    }

    // All three acknowledgements must be explicitly accepted
    const acknowledgementValidation = validateAcknowledgements(acknowledgements);
    if (!acknowledgementValidation.isValid) {
      return {
        success: false,
        message: acknowledgementValidation.message,
        missing: acknowledgementValidation.missing
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, termsAcceptedAt: true }
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Build the stored record from the server's own list, not from the request,
    // so a client cannot invent extra acknowledgement keys. Validation above has
    // already proven every required key was accepted.
    const acceptedFlags = Object.keys(REQUIRED_ACKNOWLEDGEMENTS).reduce(
      (flags, key) => ({ ...flags, [key]: true }),
      {}
    );

    const trimmedOrganization = typeof organization === 'string' ? organization.trim() : '';

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        organization: trimmedOrganization || null,
        profession: canonicalProfession,
        intendedUsage: intendedUsage.trim(),
        // First acceptance stands; a resubmit does not move the timestamp.
        termsAcceptedAt: user.termsAcceptedAt || new Date(),
        acknowledgements: acceptedFlags
      },
      select: onboardingSelect
    });

    return {
      success: true,
      message: 'Onboarding completed successfully',
      user: updatedUser
    };
  } catch (error) {
    console.error('Complete onboarding error:', error);
    return { success: false, message: 'Failed to complete onboarding' };
  }
};

module.exports = {
  defaultSettings,
  onboardingSelect,
  getUserSettings,
  updateUserSettings,
  setUserCountry,
  getUserProfile,
  completeOnboarding
};
