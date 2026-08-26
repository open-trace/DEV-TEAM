/**
 * Options and limits for the onboarding form shown after a plan is selected.
 *
 * The profession list must stay in step with the frontend's dropdown: a value
 * that is not on this list is rejected with a 400, so adding an option to the
 * UI without adding it here silently breaks that option for every user.
 */

/**
 * Role / Profession dropdown values, in the order the frontend lists them.
 */
const PROFESSIONS = [
  'Farmer',
  'Cooperative Leader',
  'Extension Agent',
  'Policy Analyst',
  'Government Official',
  'NGO / Development Practitioner',
  'Researcher / Academic',
  'Agribusiness Professional',
  'Financial / Investment Analyst',
  'Consultant',
  'Student',
  'Journalist / Media Professional',
  'Technology / Data Professional',
  'Other'
];

/**
 * The acknowledgements a user must give before onboarding can complete, keyed
 * by the field name the API expects. `label` records the wording shown on the
 * form so a stored acceptance can be traced back to what was actually agreed to.
 */
const REQUIRED_ACKNOWLEDGEMENTS = {
  privacyPolicy: "I've read and agree to the Privacy Policy.",
  termsOfUse: "I've read and agree to the Terms of Use.",
  knowledgeCentre:
    "I've reviewed the Knowledge Centre and understand Ask ADZA outputs include confidence indicators and are not professional advice."
};

/** Maximum length of the Organization / Company Name field (column is VARCHAR(191)). */
const MAX_ORGANIZATION_LENGTH = 191;

/** Maximum length of the Intended Usage field (column is TEXT, but keep payloads sane). */
const MAX_INTENDED_USAGE_LENGTH = 2000;

/** Minimum length of Intended Usage, so a single stray character is not accepted. */
const MIN_INTENDED_USAGE_LENGTH = 10;

/**
 * Collapse whitespace so "NGO/Development Practitioner" and
 * "NGO  /  Development  Practitioner" compare equal.
 * @param {string} value
 * @returns {string}
 */
const collapse = (value) => value.trim().replace(/\s+/g, '').toLowerCase();

/**
 * Normalize a profession to its canonical spelling from PROFESSIONS.
 * Matching ignores case and whitespace, so minor frontend formatting
 * differences do not reject an otherwise valid selection.
 * @param {string} profession - Profession provided by the user
 * @returns {string|null} Canonical profession, or null if not recognized
 */
const normalizeProfession = (profession) => {
  if (!profession || typeof profession !== 'string') return null;
  const target = collapse(profession);
  if (!target) return null;

  return PROFESSIONS.find((option) => collapse(option) === target) || null;
};

module.exports = {
  PROFESSIONS,
  REQUIRED_ACKNOWLEDGEMENTS,
  MAX_ORGANIZATION_LENGTH,
  MAX_INTENDED_USAGE_LENGTH,
  MIN_INTENDED_USAGE_LENGTH,
  normalizeProfession
};
