const subscriptionService = require("../services/subscriptionService");

/**
 * Get all available subscription plans
 * @route GET /api/subscriptions/plans
 * @access Public
 */
exports.getPlans = async (req, res) => {
  try {
    const plans = await subscriptionService.getPlans();
    res.status(200).json(plans);
  } catch (error) {
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
    const { planType } = req.body;

    // Validate planType
    if (!planType || !planType.trim()) {
      return res.status(400).json({ error: "Plan type is required" });
    }

    // Select plan
    const subscription = await subscriptionService.selectPlan(
      req.user.id,
      planType.trim(),
    );

    res.status(201).json({
      message: "Plan selected successfully. Please complete payment.",
      subscription,
    });
  } catch (error) {
    if (error.message.includes("Invalid plan type")) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes("Use switchPlan")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Select plan error:", error);
    res.status(500).json({ error: "Failed to select plan" });
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
