const stripeService = require('../services/stripeService');
const subscriptionService = require('../services/subscriptionService');

/**
 * Create payment intent for subscription
 * @route POST /api/payments/create-intent
 * @access Protected
 */
exports.createPaymentIntent = async (req, res) => {
  try {
    // Get current subscription
    const subscription = await subscriptionService.getCurrentSubscription(req.user.id);
    if (!subscription) {
      return res.status(400).json({ error: 'No pending subscription found. Please select a plan first.' });
    }

    if (subscription.status !== 'pending') {
      return res.status(400).json({ error: 'Subscription is already active or cancelled' });
    }

    // Create payment intent
    const paymentDetails = await stripeService.createPaymentIntent(
      req.user.id,
      req.user.email,
      subscription.planType,
      subscription.price,
      subscription.billingFrequency
    );

    res.status(200).json({
      message: paymentDetails.requiresPayment === false
        ? 'Subscription activated from your existing Stripe balance'
        : 'Payment intent created',
      ...paymentDetails
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: error.message || 'Failed to create payment intent' });
  }
};

/**
 * Confirm payment and activate subscription
 * @route POST /api/payments/confirm
 * @access Protected
 */
exports.confirmPayment = async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'paymentIntentId is required' });
    }

    // Confirm payment and activate subscription
    const subscription = await stripeService.confirmPayment(req.user.id, paymentIntentId);

    res.status(200).json({
      message: 'Payment confirmed and subscription activated',
      subscription
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(400).json({ error: error.message || 'Failed to confirm payment' });
  }
};

/**
 * Cancel subscription
 * @route POST /api/payments/cancel
 * @access Protected
 */
exports.cancelSubscription = async (req, res) => {
  try {
    const result = await stripeService.cancelStripeSubscription(req.user.id);

    res.status(200).json({
      message: 'Subscription scheduled to cancel at the end of the current billing period',
      cancellation: result
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(400).json({ error: error.message || 'Failed to cancel subscription' });
  }
};

/**
 * Upgrade or change subscription plan
 * @route POST /api/payments/upgrade
 * @access Protected
 */
exports.upgradeSubscription = async (req, res) => {
  try {
    const { planType, billingFrequency } = req.body;

    if (typeof planType !== 'string' || !planType.trim()) {
      return res.status(400).json({ error: 'planType is required' });
    }

    if (billingFrequency !== undefined && typeof billingFrequency !== 'string') {
      return res.status(400).json({ error: 'billingFrequency must be a string' });
    }

    // Upgrade subscription
    const result = await stripeService.upgradeSubscription(
      req.user.id,
      planType.trim(),
      billingFrequency?.trim()
    );

    if (result.status === 'pending_payment') {
      return res.status(200).json({
        message: 'Upgrade is pending payment confirmation',
        ...result
      });
    }

    res.status(200).json({
      message: 'Subscription upgraded successfully',
      ...result
    });
  } catch (error) {
    console.error('Upgrade subscription error:', error);
    res.status(400).json({ error: error.message || 'Failed to upgrade subscription' });
  }
};

/**
 * Handle Stripe webhook
 * @route POST /api/payments/webhooks/stripe
 * @access Public (verified by Stripe signature)
 */
exports.handleStripeWebhook = async (req, res) => {
  try {
    // Get raw body and signature from headers
    const sig = req.headers['stripe-signature'];

    // req.rawBody is set by middleware as a Buffer
    if (!req.rawBody) {
      return res.status(400).json({ error: 'No request body received' });
    }

    // Verify and parse webhook
    const event = stripeService.verifyWebhookSignature(
      req.rawBody,
      sig
    );

    // Process event
    await stripeService.handleWebhookEvent(event);

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: error.message });
  }
};
