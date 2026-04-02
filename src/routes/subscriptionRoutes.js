const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const {
  getPlans,
  selectPlan,
  getCurrentSubscription,
  switchPlan,
  activateSubscription,
  cancelSubscription
} = require('../controllers/subscriptionController');

/**
 * @route   GET /api/subscriptions/plans
 * @desc    Get all available subscription plans
 * @access  Public (no authentication needed)
 */
router.get('/plans', getPlans);

/**
 * @route   POST /api/subscriptions/select
 * @desc    Select a subscription plan (creates pending subscription)
 * @access  Protected (requires authentication)
 */
router.post('/select', auth, selectPlan);

/**
 * @route   GET /api/subscriptions/current
 * @desc    Get user's current subscription
 * @access  Protected (requires authentication)
 */
router.get('/current', auth, getCurrentSubscription);

/**
 * @route   PUT /api/subscriptions/switch
 * @desc    Switch/upgrade subscription plan
 * @access  Protected (requires authentication)
 */
router.put('/switch', auth, switchPlan);

/**
 * @route   POST /api/subscriptions/activate
 * @desc    Activate subscription (after payment confirmation)
 * @access  Protected (requires authentication)
 */
router.post('/activate', auth, activateSubscription);

/**
 * @route   POST /api/subscriptions/cancel
 * @desc    Cancel subscription
 * @access  Protected (requires authentication)
 */
router.post('/cancel', auth, cancelSubscription);

module.exports = router;
