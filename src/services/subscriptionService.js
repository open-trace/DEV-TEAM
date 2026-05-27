const prisma = require("../utils/prismaClient");

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

const roundCurrency = (amount) =>
  Number((Math.round(amount * 100 + 1e-6) / 100).toFixed(2));

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
 * @returns {array} Array of available plans with pricing
 */
exports.getPlans = async () => {
  const plans = Object.entries(SUBSCRIPTION_PLANS).map(([key, value]) => ({
    id: key,
    name: value.name,
    price: value.price,
    monthlyPrice: value.price,
    billingOptions: buildBillingOptions(value.price),
    queriesPerMonth: value.queriesPerMonth,
    description: value.description,
    features: value.features,
  }));

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
        queriesUsedThisMonth: 0,
        monthResetDate: monthResetDate,
        status: isFreeplan ? "active" : "pending",
      },
    });
    return updatedSubscription;
  }

  // If user has an ACTIVE subscription, they must use switchPlan
  if (existingSubscription?.status === "active") {
    throw new Error(
      "You already have an active subscription. Use switchPlan to change plans.",
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
        queriesUsedThisMonth: 0,
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
    queriesUsedThisMonth: 0,
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

  // Month has passed, reset the counter and update monthResetDate to next month
  const updatedSubscription = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      queriesUsedThisMonth: 0,
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

    // Integrated plan has unlimited queries (queriesPerMonth is null)
    if (updatedSubscription.queriesPerMonth === null) {
      return {
        success: true,
        hasQueries: true,
        queriesRemaining: null, // unlimited
        message: "Unlimited queries available",
      };
    }

    // Calculate remaining queries
    const queriesRemaining = updatedSubscription.queriesPerMonth - updatedSubscription.queriesUsedThisMonth;

    // Check if queries remain
    if (queriesRemaining <= 0) {
      return {
        success: false,
        hasQueries: false,
        queriesRemaining: 0,
        message: `Query limit reached. You have used ${updatedSubscription.queriesUsedThisMonth} of ${updatedSubscription.queriesPerMonth} queries this month.`,
      };
    }

    return {
      success: true,
      hasQueries: true,
      queriesRemaining,
      message: `You have ${queriesRemaining} queries remaining this month.`,
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
 * Increment query usage for user (called after a successful query)
 * @param {string} userId - User's ID
 * @returns {object} { success, queriesRemaining, message }
 */
exports.incrementQueryUsage = async (userId) => {
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

    // Integrated plan (unlimited) - don't increment
    if (updatedSubscription.queriesPerMonth === null) {
      return {
        success: true,
        queriesRemaining: null,
        message: "Query recorded (unlimited plan)",
      };
    }

    // Increment usage
    const newUsage = updatedSubscription.queriesUsedThisMonth + 1;

    const resultSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        queriesUsedThisMonth: newUsage,
      },
    });

    const queriesRemaining = resultSubscription.queriesPerMonth - resultSubscription.queriesUsedThisMonth;

    return {
      success: true,
      queriesRemaining,
      message: `Query recorded. ${queriesRemaining} queries remaining this month.`,
    };
  } catch (error) {
    console.error("Increment query usage error:", error);
    return {
      success: false,
      message: "Error recording query usage",
    };
  }
};
