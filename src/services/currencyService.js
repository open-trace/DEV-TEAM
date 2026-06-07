const axios = require("axios");

const DEFAULT_API_URL = "https://v6.exchangerate-api.com/v6";
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_CACHE_HOURS = 24;

// The cache lives in this Node process and is cleared when the app restarts.
let exchangeRateCache = null;
let exchangeRateCacheExpiresAt = 0;

/**
 * Create an error with a stable code so callers do not depend on message text.
 */
const createCurrencyError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

/**
 * Read and validate the exchange-rate provider configuration.
 * The API key stays on the backend and is never sent to the frontend.
 */
const getApiConfig = () => {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  const apiUrl = (process.env.EXCHANGE_RATE_API_URL || DEFAULT_API_URL).replace(
    /\/+$/,
    "",
  );

  if (!apiKey) {
    throw new Error("Exchange-rate API key is not configured");
  }

  return { apiKey, apiUrl };
};

/**
 * Convert the configured cache duration from hours to milliseconds.
 */
const getCacheDurationMs = () => {
  const configuredHours = Number(process.env.EXCHANGE_RATE_CACHE_HOURS);
  const cacheHours =
    Number.isFinite(configuredHours) && configuredHours > 0
      ? configuredHours
      : DEFAULT_CACHE_HOURS;

  return cacheHours * 60 * 60 * 1000;
};

/**
 * Convert input such as " kes " to the ISO-style code "KES".
 */
const normalizeCurrencyCode = (currency) => {
  if (typeof currency !== "string") {
    throw createCurrencyError(
      "Currency must be a three-letter code",
      "INVALID_CURRENCY_CODE",
    );
  }

  const normalizedCurrency = currency.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw createCurrencyError(
      "Currency must be a three-letter code",
      "INVALID_CURRENCY_CODE",
    );
  }

  return normalizedCurrency;
};

/**
 * Fetch the provider's latest exchange rates with USD as the base currency.
 * One response contains all supported target currencies.
 */
const getUsdExchangeRates = async () => {
  // Reuse the previous provider response while it is still fresh.
  if (exchangeRateCache && Date.now() < exchangeRateCacheExpiresAt) {
    return exchangeRateCache;
  }

  const { apiKey, apiUrl } = getApiConfig();

  try {
    // Example request: /API_KEY/latest/USD
    const response = await axios.get(`${apiUrl}/${apiKey}/latest/USD`, {
      timeout: REQUEST_TIMEOUT_MS,
    });

    // The provider can return HTTP 200 with an error result in the response body.
    if (
      response.data?.result !== "success" ||
      !response.data?.conversion_rates
    ) {
      throw new Error(
        response.data?.["error-type"] || "Invalid exchange-rate response",
      );
    }

    const exchangeRates = {
      baseCurrency: response.data.base_code,
      rates: response.data.conversion_rates,
      lastUpdatedAt: response.data.time_last_update_utc || null,
      nextUpdateAt: response.data.time_next_update_utc || null,
    };

    exchangeRateCache = exchangeRates;
    exchangeRateCacheExpiresAt = Date.now() + getCacheDurationMs();

    return exchangeRates;
  } catch (error) {
    console.error(
      "Exchange-rate API error:",
      error.response?.data?.["error-type"] || error.message,
    );
    throw new Error("Unable to retrieve current exchange rates");
  }
};

/**
 * Clear cached rates manually, mainly for testing or forced refreshes.
 */
const clearExchangeRateCache = () => {
  exchangeRateCache = null;
  exchangeRateCacheExpiresAt = 0;
};

/**
 * Get the exchange rate from one USD to the requested currency.
 */
const getUsdExchangeRate = async (currency) => {
  const normalizedCurrency = normalizeCurrencyCode(currency);

  // USD does not need a provider request because one USD always equals one USD.
  if (normalizedCurrency === "USD") {
    return {
      currency: "USD",
      rate: 1,
      lastUpdatedAt: null,
      nextUpdateAt: null,
    };
  }

  const exchangeRates = await getUsdExchangeRates();
  const rate = exchangeRates.rates[normalizedCurrency];

  // A three-letter code can be valid in shape but unsupported by the provider.
  if (typeof rate !== "number" || rate <= 0) {
    throw createCurrencyError(
      `Unsupported currency: ${normalizedCurrency}`,
      "UNSUPPORTED_CURRENCY",
    );
  }

  return {
    currency: normalizedCurrency,
    rate,
    lastUpdatedAt: exchangeRates.lastUpdatedAt,
    nextUpdateAt: exchangeRates.nextUpdateAt,
  };
};

/**
 * Convert a USD plan price into an approximate local-currency display price.
 * Stripe will continue charging the original USD amount.
 */
const convertUsdAmount = async (usdAmount, currency) => {
  const amount = Number(usdAmount);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("USD amount must be a non-negative number");
  }

  const exchangeRate = await getUsdExchangeRate(currency);

  return {
    usdAmount: amount,
    // Local display prices are rounded to two decimal places.
    localAmount: Number((amount * exchangeRate.rate).toFixed(2)),
    currency: exchangeRate.currency,
    exchangeRate: exchangeRate.rate,
    lastUpdatedAt: exchangeRate.lastUpdatedAt,
    nextUpdateAt: exchangeRate.nextUpdateAt,
  };
};

module.exports = {
  normalizeCurrencyCode,
  getUsdExchangeRates,
  getUsdExchangeRate,
  convertUsdAmount,
  clearExchangeRateCache,
};
