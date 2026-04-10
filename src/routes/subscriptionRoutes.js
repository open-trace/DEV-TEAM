const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const {
  getPlans,
  selectPlan,
  getCurrentSubscription,
  isSubscriptionActive,
} = require("../controllers/subscriptionController");

/**
 * @route   GET /api/subscriptions/plans
 * @desc    Get all available subscription plans
 * @access  Public (no authentication needed)
 */
router.get("/plans", getPlans);

/**
 * @route   POST /api/subscriptions/select
 * @desc    Select a subscription plan (creates pending subscription)
 * @access  Protected (requires authentication)
 */
router.post("/select", auth, selectPlan);

/**
 * @route   GET /api/subscriptions/current
 * @desc    Get user's current subscription
 * @access  Protected (requires authentication)
 */
router.get("/current", auth, getCurrentSubscription);

/**
 * @route   GET /api/subscriptions/is-active
 * @desc    Check if user's subscription is active
 * @access  Protected (requires authentication)
 */
router.get("/is-active", auth, isSubscriptionActive);

module.exports = router;
