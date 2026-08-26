const { normalizeCountry } = require('./countries');
const {
  REQUIRED_ACKNOWLEDGEMENTS,
  MAX_ORGANIZATION_LENGTH,
  MAX_INTENDED_USAGE_LENGTH,
  MIN_INTENDED_USAGE_LENGTH,
  normalizeProfession
} = require('./onboardingOptions');

/**
 * Validate email format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid, false otherwise
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} { isValid: boolean, message: string }
 */
const isValidPassword = (password) => {
  if (!password || password.length < 8) {
    return {
      isValid: false,
      message: 'Password must be at least 8 characters long'
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      message: 'Password must contain at least one uppercase letter'
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      message: 'Password must contain at least one lowercase letter'
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      isValid: false,
      message: 'Password must contain at least one number'
    };
  }

  return {
    isValid: true,
    message: 'Password is valid'
  };
};

/**
 * Validate name (optional but if provided, must be valid)
 * @param {string} name - Name to validate
 * @returns {boolean} True if valid or empty, false otherwise
 */
const isValidName = (name) => {
  if (!name) return true; // Name is optional
  return name.trim().length >= 2 && name.trim().length <= 50;
};

/**
 * Validate that a country is a recognized ISO 3166-1 country.
 * @param {string} country - Country to validate
 * @returns {boolean} True if recognized, false otherwise
 */
const isValidCountry = (country) => normalizeCountry(country) !== null;

/**
 * Validate the Organization / Company Name field. Optional on the onboarding
 * form, so an empty value is valid; a value that is present must fit the column.
 * @param {string} organization - Organization to validate
 * @returns {object} { isValid: boolean, message: string }
 */
const isValidOrganization = (organization) => {
  if (organization === undefined || organization === null) {
    return { isValid: true, message: 'Organization is optional' };
  }

  if (typeof organization !== 'string') {
    return { isValid: false, message: 'Organization must be text' };
  }

  if (organization.trim() === '') {
    return { isValid: true, message: 'Organization is optional' };
  }

  if (organization.trim().length > MAX_ORGANIZATION_LENGTH) {
    return {
      isValid: false,
      message: `Organization must be ${MAX_ORGANIZATION_LENGTH} characters or fewer`
    };
  }

  return { isValid: true, message: 'Organization is valid' };
};

/**
 * Validate the Intended Usage field. Required at onboarding.
 * @param {string} intendedUsage - Intended usage to validate
 * @returns {object} { isValid: boolean, message: string }
 */
const isValidIntendedUsage = (intendedUsage) => {
  if (!intendedUsage || typeof intendedUsage !== 'string' || !intendedUsage.trim()) {
    return { isValid: false, message: 'Intended usage is required' };
  }

  const trimmed = intendedUsage.trim();

  if (trimmed.length < MIN_INTENDED_USAGE_LENGTH) {
    return {
      isValid: false,
      message: `Please describe your intended usage in at least ${MIN_INTENDED_USAGE_LENGTH} characters`
    };
  }

  if (trimmed.length > MAX_INTENDED_USAGE_LENGTH) {
    return {
      isValid: false,
      message: `Intended usage must be ${MAX_INTENDED_USAGE_LENGTH} characters or fewer`
    };
  }

  return { isValid: true, message: 'Intended usage is valid' };
};

/**
 * Validate that a profession is one of the recognized dropdown options.
 * @param {string} profession - Profession to validate
 * @returns {boolean} True if recognized, false otherwise
 */
const isValidProfession = (profession) => normalizeProfession(profession) !== null;

/**
 * Check that every required acknowledgement was explicitly given. Only a real
 * boolean `true` counts - a missing key, a string, or false is a refusal.
 * @param {object} acknowledgements - Acknowledgement flags from the request
 * @returns {object} { isValid: boolean, message: string, missing: string[] }
 */
const validateAcknowledgements = (acknowledgements) => {
  if (!acknowledgements || typeof acknowledgements !== 'object' || Array.isArray(acknowledgements)) {
    return {
      isValid: false,
      message: 'All required acknowledgements must be accepted',
      missing: Object.keys(REQUIRED_ACKNOWLEDGEMENTS)
    };
  }

  const missing = Object.keys(REQUIRED_ACKNOWLEDGEMENTS).filter(
    (key) => acknowledgements[key] !== true
  );

  if (missing.length > 0) {
    return {
      isValid: false,
      message: 'All required acknowledgements must be accepted',
      missing
    };
  }

  return { isValid: true, message: 'Acknowledgements accepted', missing: [] };
};

module.exports = {
  isValidEmail,
  isValidPassword,
  isValidName,
  isValidCountry,
  normalizeCountry,
  isValidOrganization,
  isValidIntendedUsage,
  isValidProfession,
  validateAcknowledgements,
  normalizeProfession
};
