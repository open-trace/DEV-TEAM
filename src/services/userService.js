const { PrismaClient } = require('@prisma/client');

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

module.exports = {
  defaultSettings,
  getUserSettings,
  updateUserSettings
};
