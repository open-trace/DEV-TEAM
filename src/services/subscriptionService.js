const prisma = require("../utils/prismaClient");
const { getUsdExchangeRate } = require("./currencyService");

const BILLING_FREQUENCIES = {
  monthly: {
    label: "Monthly",
    interval: "month",
    intervalCount: 1,
    billingPeriodMonths: 1,
    discountPercent: 0,
    discountLabel: "no discount",
  },
  quarterly: {
    label: "Quarterly",
    interval: "month",
    intervalCount: 3,
    billingPeriodMonths: 3,
    discountPercent: 10,
    discountLabel: "save 10%",
  },
  yearly: {
    label: "Yearly",
    interval: "year",
    intervalCount: 1,
    billingPeriodMonths: 12,
    discountPercent: 16.67,
    discountLabel: "2 months free (~17%)",
    freeMonths: 2,
  },
};

const DEFAULT_BILLING_FREQUENCY = "monthly";
// 1 usage credit = 10,000 tokens. Sized so a typical RAG query (~8k tokens, more
// with chat history) costs ~1 credit, keeping per-plan credit budgets roughly in
// line with each plan's estimated queries/month.
const DEFAULT_TOKENS_PER_USAGE_CREDIT = 10000;

const getTokensPerUsageCredit = () => {
  const configuredValue = Number(process.env.USAGE_TOKENS_PER_CREDIT);
  return configuredValue > 0 ? configuredValue : DEFAULT_TOKENS_PER_USAGE_CREDIT;
};

const roundCurrency = (amount) =>
  Number((Math.round(amount * 100 + 1e-6) / 100).toFixed(2));

/**
 * Build an approximate local display price without changing the USD price.
 */
const buildLocalPrice = (usdAmount, exchangeRate) => {
  if (exchangeRate.currency === "USD") {
    return null;
  }

  return {
    amount: roundCurrency(usdAmount * exchangeRate.rate),
    currency: exchangeRate.currency,
    isEstimate: true,
  };
};

/**
 * Add local display prices to each billing option.
 */
const addLocalPricesToBillingOptions = (billingOptions, exchangeRate) =>
  billingOptions.map((option) => ({
    ...option,
    localPrice: buildLocalPrice(option.price, exchangeRate),
    localEquivalentMonthlyPrice: buildLocalPrice(
      option.equivalentMonthlyPrice,
      exchangeRate,
    ),
  }));

const roundUsageCredits = (credits) =>
  Number((Math.round(credits * 10000 + 1e-8) / 10000).toFixed(4));

const calculateUsageCredits = (tokenUsage = {}) => {
  const totalTokens = Number(tokenUsage.totalTokens) || 0;

  if (totalTokens <= 0) {
    return 1;
  }

  return roundUsageCredits(totalTokens / getTokensPerUsageCredit());
};

const calculateUsagePercent = (usedCredits, limitCredits) => {
  if (limitCredits === null || limitCredits === undefined) {
    return null;
  }

  if (limitCredits <= 0) {
    return 100;
  }

  return Math.min(100, Math.round((usedCredits / limitCredits) * 100));
};

const buildUsageSummary = (subscription) => {
  const usedCredits = Number(subscription.usageCreditsUsedThisMonth) || 0;
  const limitCredits =
    subscription.usageCreditsPerMonth === null ||
    subscription.usageCreditsPerMonth === undefined
      ? null
      : Number(subscription.usageCreditsPerMonth);
  const usagePercent = calculateUsagePercent(usedCredits, limitCredits);
  const remainingCredits =
    limitCredits === null || limitCredits === undefined
      ? null
      : Math.max(0, roundUsageCredits(limitCredits - usedCredits));

  return {
    usageCreditsUsed: roundUsageCredits(usedCredits),
    usageCreditsLimit: limitCredits,
    usageCreditsRemaining: remainingCredits,
    usagePercent,
    remainingPercent: usagePercent === null ? null : Math.max(0, 100 - usagePercent),
    isUnlimited: limitCredits === null || limitCredits === undefined,
  };
};

const buildBillingOption = (billingFrequency, price, equivalentMonthlyPrice) => ({
  billingFrequency,
  ...BILLING_FREQUENCIES[billingFrequency],
  price,
  equivalentMonthlyPrice,
});

const buildBillingOptions = (monthlyPrice) => {
  const monthly = buildBillingOption("monthly", monthlyPrice, monthlyPrice);

  if (monthlyPrice === 0) {
    return [monthly];
  }

  const quarterlyPrice = roundCurrency(monthlyPrice * 3 * 0.9);
  const yearlyPrice = roundCurrency(monthlyPrice * 10);

  return [
    monthly,
    buildBillingOption("quarterly", quarterlyPrice, roundCurrency(quarterlyPrice / 3)),
    buildBillingOption("yearly", yearlyPrice, roundCurrency(yearlyPrice / 12)),
  ];
};

const normalizeBillingFrequency = (billingFrequency = DEFAULT_BILLING_FREQUENCY) => {
  if (!billingFrequency) {
    return DEFAULT_BILLING_FREQUENCY;
  }

  return String(billingFrequency).trim().toLowerCase();
};

const getBillingOptionForPlan = (planConfig, billingFrequency) => {
  const normalizedBillingFrequency = normalizeBillingFrequency(billingFrequency);
  const billingOption = buildBillingOptions(planConfig.price).find(
    (option) => option.billingFrequency === normalizedBillingFrequency,
  );

  if (!billingOption) {
    throw new Error(`Invalid billing frequency: ${billingFrequency}`);
  }

  return billingOption;
};

/**
 * Available subscription plans with pricing
 */
const SUBSCRIPTION_PLANS = {
  Free: {
    name: "Free",
    price: 0,
    queriesPerMonth: 5,
    usageCreditsPerMonth: 5,
    description: "Try Ask ADZA, explore Africa's agricultural intelligence with a handful of questions a month, no commitment.",
    features: [
      "5 queries/mo",
      "One country at a time",
      "Top-line insights only",
      "No comparisons, exports, or historical trends",
      "Email sign-up required"
    ]
  },
  Farmers: {
    name: "Farmers, Cooperatives & Communities",
    price: 2.99,
    queriesPerMonth: 50,
    usageCreditsPerMonth: 50,
    description: "Track rainfall, local yields, and market prices for your crops, in plain language.",
    features: [
      "Localized regional insights",
      "Crop & price queries",
      "Mobile-friendly outputs",
      "50 queries/mo"
    ]
  },
  Government: {
    name: "Government & Public Institutions",
    price: 9.99,
    queriesPerMonth: 200,
    usageCreditsPerMonth: 200,
    description: "Explore production, climate, and food security patterns across regions, without waiting months for fragmented reports.",
    features: [
      "National + sub-national queries",
      "Historical trend comparisons",
      "ACF-attributed sources",
      "200 queries/mo"
    ]
  },
  NGOs: {
    name: "Foundations, NGOs & Development Partners",
    price: 14.99,
    queriesPerMonth: 400,
    usageCreditsPerMonth: 400,
    description: "Target programs, monitor field conditions, and back funding decisions with continuous, evidence-based intelligence.",
    features: [
      "Everything in Government",
      "Multi-region overlap analysis",
      "Program-area monitoring",
      "Exportable insights",
      "400 queries/mo"
    ]
  },
  Agribusinesses: {
    name: "Agribusinesses & Financial Institutions",
    price: 24.99,
    queriesPerMonth: 800,
    usageCreditsPerMonth: 800,
    description: "Assess production stability, market volatility, and regional risk to sharpen sourcing, lending, and investment decisions.",
    features: [
      "Everything in NGO",
      "Market & price volatility",
      "Sourcing risk profiles",
      "Cross-country comparison",
      "800 queries/mo"
    ]
  },
  Integrated: {
    name: "Integrated Account",
    price: 39.99,
    queriesPerMonth: null, // unlimited
    usageCreditsPerMonth: null, // unlimited
    description: "Full cross-sector access for consultants, researchers, and teams working across multiple stakeholder lenses.",
    features: [
      "All lenses combined",
      "Unlimited fair-use queries",
      "Priority support",
      "Early access to new features"
    ]
  },
};

exports.getPlanConfig = (planType) => {
  const plan = SUBSCRIPTION_PLANS[planType];

  if (!plan) {
    return null;
  }

  return {
    ...plan,
    monthlyPrice: plan.price,
    billingOptions: buildBillingOptions(plan.price),
  };
};

exports.getPlanPrice = (planType) => SUBSCRIPTION_PLANS[planType]?.price ?? null;

exports.getBillingOption = (planType, billingFrequency) => {
  const planConfig = SUBSCRIPTION_PLANS[planType];

  if (!planConfig) {
    return null;
  }

  return getBillingOptionForPlan(planConfig, billingFrequency);
};

/**
 * Get all available subscription plans
 * @param {string} displayCurrency - Currency requested for display pricing
 * @returns {array} Array of available plans with pricing
 */
exports.getPlans = async (displayCurrency = "USD") => {
  let exchangeRate;
  let localPricingAvailable = true;
  let localPricingUnavailableReason = null;

  try {
    // Fetch one rate and reuse it for every plan and billing frequency.
    exchangeRate = await getUsdExchangeRate(displayCurrency);
  } catch (error) {
    // Malformed codes are caller errors and should be returned as HTTP 400.
    if (error.code === "INVALID_CURRENCY_CODE") {
      throw error;
    }

    // Unsupported currencies and provider failures should not block USD plans.
    console.error("Local pricing unavailable:", error.message);
    localPricingAvailable = false;
    localPricingUnavailableReason = error.code === "UNSUPPORTED_CURRENCY"
      ? "unsupported_currency"
      : "exchange_rate_unavailable";
    exchangeRate = {
      currency: "USD",
      rate: 1,
      lastUpdatedAt: null,
      nextUpdateAt: null,
    };
  }

  const plans = Object.entries(SUBSCRIPTION_PLANS).map(([key, value]) => {
    const billingOptions = buildBillingOptions(value.price);

    return {
      id: key,
      name: value.name,
      price: value.price,
      monthlyPrice: value.price,
      currency: "USD",
      localPrice: localPricingAvailable
        ? buildLocalPrice(value.price, exchangeRate)
        : null,
      billingOptions: localPricingAvailable
        ? addLocalPricesToBillingOptions(billingOptions, exchangeRate)
        : addLocalPricesToBillingOptions(billingOptions, {
            ...exchangeRate,
            currency: "USD",
          }),
      localPricing: {
        requestedCurrency: displayCurrency,
        available: localPricingAvailable,
        isEstimate: localPricingAvailable && exchangeRate.currency !== "USD",
        reason: localPricingUnavailableReason,
      },
      exchangeRate: {
        baseCurrency: "USD",
        displayCurrency: localPricingAvailable ? exchangeRate.currency : null,
        rate: localPricingAvailable ? exchangeRate.rate : null,
        lastUpdatedAt: exchangeRate.lastUpdatedAt,
        nextUpdateAt: exchangeRate.nextUpdateAt,
      },
      queriesPerMonth: value.queriesPerMonth,
      usageCreditsPerMonth: value.usageCreditsPerMonth,
      description: value.description,
      features: value.features,
    };
  });

  return plans;
};

/**
 * Helper function to calculate month reset date (first day of next month)
 */
const getNextMonthResetDate = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
};

exports.getNextMonthResetDate = getNextMonthResetDate;

/**
 * Select a subscription plan for a user
 * @param {string} userId - User's ID
 * @param {string} planType - Plan type (Free, Farmers, Government, NGOs, Agribusinesses, Integrated)
 * @param {string} billingFrequency - Billing frequency (monthly, quarterly, yearly)
 * @returns {object} Created or updated subscription
 */
exports.selectPlan = async (userId, planType, billingFrequency = DEFAULT_BILLING_FREQUENCY) => {
  // Validate plan type
  if (!SUBSCRIPTION_PLANS[planType]) {
    throw new Error(`Invalid plan type: ${planType}`);
  }

  const planConfig = SUBSCRIPTION_PLANS[planType];
  const billingOption = getBillingOptionForPlan(planConfig, billingFrequency);
  const isFreeplan = planType === "Free";
  const monthResetDate = getNextMonthResetDate();

  // Check if user already has a subscription
  const existingSubscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  // If user has a PENDING subscription, allow them to change their plan selection
  if (existingSubscription?.status === "pending") {
    const updatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        planType,
        billingFrequency: billingOption.billingFrequency,
        price: billingOption.price,
        queriesPerMonth: planConfig.queriesPerMonth,
        usageCreditsPerMonth: planConfig.usageCreditsPerMonth,
        queriesUsedThisMonth: 0,
        usageCreditsUsedThisMonth: 0,
        monthResetDate: monthResetDate,
        status: isFreeplan ? "active" : "pending",
      },
    });
    return updatedSubscription;
  }

  // If user has an ACTIVE subscription (including Free), plan changes go through
  // POST /api/payments/upgrade rather than plan selection.
  if (existingSubscription?.status === "active") {
    throw new Error(
      "You already have an active subscription. Use the upgrade option to change your plan.",
    );
  }

  if (existingSubscription?.status === "past_due") {
    throw new Error(
      "You have a past-due subscription. Resolve payment or cancel the current subscription before selecting a new plan.",
    );
  }

  // If user has CANCELLED or EXPIRED subscription, allow reselection
  if (
    existingSubscription?.status === "cancelled" ||
    existingSubscription?.status === "expired"
  ) {
    const reactivatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        planType,
        billingFrequency: billingOption.billingFrequency,
        price: billingOption.price,
        queriesPerMonth: planConfig.queriesPerMonth,
        usageCreditsPerMonth: planConfig.usageCreditsPerMonth,
        queriesUsedThisMonth: 0,
        usageCreditsUsedThisMonth: 0,
        monthResetDate: monthResetDate,
        status: isFreeplan ? "active" : "pending", // Free plan is immediately active
      },
    });
    return reactivatedSubscription;
  }

  // Create new subscription
  const subscriptionData = {
    userId,
    planType,
    billingFrequency: billingOption.billingFrequency,
    price: billingOption.price,
    queriesPerMonth: planConfig.queriesPerMonth,
    usageCreditsPerMonth: planConfig.usageCreditsPerMonth,
    queriesUsedThisMonth: 0,
    usageCreditsUsedThisMonth: 0,
    monthResetDate: monthResetDate,
    status: isFreeplan ? "active" : "pending", // Free plan is immediately active, paid plans are pending
  };

  const subscription = await prisma.subscription.create({
    data: subscriptionData,
  });

  return subscription;
};

/**
 * Get user's current subscription
 * @param {string} userId - User's ID
 * @returns {object} User's subscription with plan details
 */
exports.getCurrentSubscription = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription) {
    return null; // No subscription yet
  }

  // Include plan details
  const planDetails = SUBSCRIPTION_PLANS[subscription.planType];
  const billingOptions = buildBillingOptions(planDetails.price);
  const billingOption =
    billingOptions.find(
      (option) =>
        option.billingFrequency ===
        normalizeBillingFrequency(subscription.billingFrequency),
    ) || billingOptions[0];

  return {
    ...subscription,
    planName: planDetails.name,
    planDescription: planDetails.description,
    monthlyPrice: planDetails.price,
    usage: buildUsageSummary(subscription),
    billingOption,
    billingOptions,
    isActive: subscription.status === "active" || subscription.status === "past_due",
  };
};

/**
 * Check if subscription currently has access
 * @param {string} userId - User's ID
 * @returns {boolean} True if active or in retry recovery, false otherwise
 */
exports.isSubscriptionActive = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  return subscription?.status === "active" || subscription?.status === "past_due";
};

/**
 * Reset monthly queries if month has passed
 * @param {object} subscription - Subscription object
 * @returns {object} Updated subscription or original if no reset needed
 */
const resetMonthlyQueriesIfNeeded = async (subscription) => {
  // If no monthResetDate or monthResetDate is in the future, no reset needed
  if (!subscription.monthResetDate || new Date() < new Date(subscription.monthResetDate)) {
    return subscription;
  }

  // Payment is failing: the retry window can straddle the reset date, and granting a
  // fresh allowance mid-dunning would hand out a free month. They keep whatever is
  // left, and the reset happens once payment succeeds and the plan reactivates.
  if (subscription.status === "past_due") {
    return subscription;
  }

  // Month has passed, reset the counter and update monthResetDate to next month
  const updatedSubscription = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      queriesUsedThisMonth: 0,
      usageCreditsUsedThisMonth: 0,
      monthResetDate: getNextMonthResetDate(),
    },
  });

  return updatedSubscription;
};

/**
 * Check if user has queries remaining for this month
 * @param {string} userId - User's ID
 * @returns {object} { success, hasQueries, queriesRemaining, message }
 */
exports.checkQueryLimit = async (userId) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    // User has no subscription
    if (!subscription) {
      return {
        success: false,
        hasQueries: false,
        queriesRemaining: 0,
        message: "No active subscription found",
      };
    }

    // Only active and past_due subscriptions can use chat during recovery retries
    if (subscription.status !== "active" && subscription.status !== "past_due") {
      return {
        success: false,
        hasQueries: false,
        queriesRemaining: 0,
        message: "Subscription is not active",
      };
    }

    // Reset monthly queries if needed
    const updatedSubscription = await resetMonthlyQueriesIfNeeded(subscription);

    const usage = buildUsageSummary(updatedSubscription);

    // Integrated plan has unlimited usage credits (usageCreditsPerMonth is null)
    if (usage.isUnlimited) {
      return {
        success: true,
        hasQueries: true,
        queriesRemaining: null, // unlimited
        usage,
        message: "Unlimited queries available",
      };
    }

    // Calculate remaining query count for display only. Enforcement uses usage credits.
    const queriesRemaining = Math.max(
      0,
      updatedSubscription.queriesPerMonth - updatedSubscription.queriesUsedThisMonth,
    );

    if (usage.usageCreditsRemaining <= 0) {
      return {
        success: false,
        hasQueries: false,
        queriesRemaining,
        usage,
        message: "Monthly usage limit reached.",
      };
    }

    return {
      success: true,
      hasQueries: true,
      queriesRemaining,
      usage,
      message: `You have ${usage.usageCreditsRemaining} usage credits remaining this month.`,
    };
  } catch (error) {
    console.error("Check query limit error:", error);
    return {
      success: false,
      hasQueries: false,
      queriesRemaining: 0,
      message: "Error checking query limit",
    };
  }
};

/**
 * Increment query usage for user and record token usage (called after a successful query)
 * @param {string} userId - User's ID
 * @param {object} tokenUsage - AI provider token usage
 * @param {string|null} chatId - Chat ID for the usage event
 * @returns {object} { success, queriesRemaining, message }
 */
exports.incrementQueryUsage = async (userId, tokenUsage = {}, chatId = null) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      return {
        success: false,
        message: "Subscription not found",
      };
    }

    // Reset if needed before incrementing
    const updatedSubscription = await resetMonthlyQueriesIfNeeded(subscription);

    const usageCredits = calculateUsageCredits(tokenUsage);
    const totalTokens = Number(tokenUsage.totalTokens) || 0;
    const inputTokens = Number(tokenUsage.inputTokens) || 0;
    const outputTokens = Number(tokenUsage.outputTokens) || 0;

    // Integrated plan (unlimited) - record token usage, but don't increment query count
    if (updatedSubscription.queriesPerMonth === null) {
      const resultSubscription = await prisma.$transaction(async (tx) => {
        const subscriptionResult = await tx.subscription.update({
          where: { id: updatedSubscription.id },
          data: {
            usageCreditsUsedThisMonth: {
              increment: usageCredits,
            },
          },
        });

        await tx.usageEvent.create({
          data: {
            userId,
            subscriptionId: updatedSubscription.id,
            chatId,
            inputTokens,
            outputTokens,
            totalTokens,
            usageCredits,
          },
        });

        return subscriptionResult;
      });

      return {
        success: true,
        queriesRemaining: null,
        usageCreditsUsedThisMonth: resultSubscription.usageCreditsUsedThisMonth,
        usage: buildUsageSummary(resultSubscription),
        message: "Query recorded (unlimited plan)",
      };
    }

    // Increment usage
    const newUsage = updatedSubscription.queriesUsedThisMonth + 1;

    const resultSubscription = await prisma.$transaction(async (tx) => {
      const subscriptionResult = await tx.subscription.update({
        where: { id: updatedSubscription.id },
        data: {
          queriesUsedThisMonth: newUsage,
          usageCreditsUsedThisMonth: {
            increment: usageCredits,
          },
        },
      });

      await tx.usageEvent.create({
        data: {
          userId,
          subscriptionId: updatedSubscription.id,
          chatId,
          inputTokens,
          outputTokens,
          totalTokens,
          usageCredits,
        },
      });

      return subscriptionResult;
    });

    const queriesRemaining = Math.max(
      0,
      resultSubscription.queriesPerMonth - resultSubscription.queriesUsedThisMonth,
    );
    const usage = buildUsageSummary(resultSubscription);

    return {
      success: true,
      queriesRemaining,
      usageCredits,
      usageCreditsUsedThisMonth: resultSubscription.usageCreditsUsedThisMonth,
      usage,
      message: `Query recorded. ${usage.usageCreditsRemaining} usage credits remaining this month.`,
    };
  } catch (error) {
    console.error("Increment query usage error:", error);
    return {
      success: false,
      message: "Error recording query usage",
    };
  }
};
