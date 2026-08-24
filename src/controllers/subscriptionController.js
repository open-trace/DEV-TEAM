const subscriptionService = require("../services/subscriptionService");

/**
 * Get all available subscription plans
 * @route GET /api/subscriptions/plans
 * @access Public
 */
exports.getPlans = async (req, res) => {
  try {
    const currency =
      typeof req.query.currency === "string"
        ? req.query.currency.trim().toUpperCase()
        : "USD";

    if (!/^[A-Z]{3}$/.test(currency)) {
      return res.status(400).json({
        error: "Currency must be a valid three-letter code, for example KES or USD",
      });
    }

    const plans = await subscriptionService.getPlans(currency);
    res.status(200).json(plans);
  } catch (error) {
    if (error.code === "INVALID_CURRENCY_CODE") {
      return res.status(400).json({ error: error.message });
    }

    console.error("Get plans error:", error);
    res.status(500).json({ error: "Failed to retrieve subscription plans" });
  }
};

/**
 * Select a subscription plan
 * @route POST /api/subscriptions/select
 * @access Protected
 */
exports.selectPlan = async (req, res) => {
  try {
    const { planType, billingFrequency } = req.body;

    // Validate planType
    if (typeof planType !== "string" || !planType.trim()) {
      return res.status(400).json({ error: "Plan type is required" });
    }

    if (billingFrequency !== undefined && typeof billingFrequency !== "string") {
      return res.status(400).json({ error: "Billing frequency must be a string" });
    }

    // Select plan
    const subscription = await subscriptionService.selectPlan(
      req.user.id,
      planType.trim(),
      billingFrequency?.trim(),
    );

    const message =
      subscription.planType === "Free" && subscription.status === "active"
        ? "Free plan activated successfully."
        : "Plan selected successfully. Please complete payment.";

    res.status(201).json({
      message,
      subscription,
    });
  } catch (error) {
    if (error.message.includes("Invalid plan type")) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes("Invalid billing frequency")) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes("already have an active subscription")) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes("past-due subscription")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Select plan error - Full error:", error);
    console.error("Select plan error - Message:", error.message);
    console.error("Select plan error - Stack:", error.stack);
    res.status(500).json({ error: "Failed to select plan", details: error.message });
  }
};

/**
 * Get current subscription
 * @route GET /api/subscriptions/current
 * @access Protected
 */
exports.getCurrentSubscription = async (req, res) => {
  try {
    const subscription = await subscriptionService.getCurrentSubscription(
      req.user.id,
    );

    if (!subscription) {
      return res
        .status(404)
        .json({ error: "No subscription found. Please select a plan." });
    }

    res.status(200).json(subscription);
  } catch (error) {
    console.error("Get current subscription error:", error);
    res.status(500).json({ error: "Failed to retrieve subscription" });
  }
};

/**
 * Check if subscription is active
 * @route GET /api/subscriptions/is-active
 * @access Protected
 */
exports.isSubscriptionActive = async (req, res) => {
  try {
    const isActive = await subscriptionService.isSubscriptionActive(
      req.user.id,
    );
    res.status(200).json({ isActive });
  } catch (error) {
    console.error("Check subscription active error:", error);
    res.status(500).json({ error: "Failed to check subscription status" });
  }
};
