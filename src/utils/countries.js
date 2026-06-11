/**
 * Country validation / canonicalization, backed by the maintained
 * `i18n-iso-countries` package (ISO 3166-1).
 *
 * Used to validate and canonicalize the `country` a user provides at
 * registration. The data team's RAG service relies on this value for
 * plan/country-based access control, so stored values must be consistent.
 */
const countries = require('i18n-iso-countries');
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));

/**
 * Normalize a country to its canonical ISO 3166-1 (English) name.
 * Matching is trimmed and case-insensitive (e.g. "ghana " -> "Ghana").
 * @param {string} country - Country provided by the user
 * @returns {string|null} Canonical country name, or null if not recognized
 */
const normalizeCountry = (country) => {
  if (!country || typeof country !== 'string') return null;
  const trimmed = country.trim();
  if (!trimmed) return null;

  // getAlpha2Code matches names case-insensitively (and handles known aliases)
  const code = countries.getAlpha2Code(trimmed, 'en');
  if (!code) return null;

  return countries.getName(code, 'en');
};

module.exports = { normalizeCountry };
