const express = require('express');
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * POST /api/payments/create-intent
 * Create payment intent for pending subscription
 * Protected - requires auth
 */
router.post('/create-intent', authMiddleware, paymentController.createPaymentIntent);

/**
 * POST /api/payments/confirm
 * Confirm payment and activate subscription
 * Protected - requires auth
 */
router.post('/confirm', authMiddleware, paymentController.confirmPayment);

/**
 * POST /api/payments/cancel
 * Cancel active subscription
 * Protected - requires auth
 */
router.post('/cancel', authMiddleware, paymentController.cancelSubscription);

/**
 * POST /api/payments/upgrade
 * Upgrade or change subscription plan
 * Protected - requires auth
 */
router.post('/upgrade', authMiddleware, paymentController.upgradeSubscription);

/**
 * POST /api/payments/webhooks/stripe
 * Stripe webhook handler for events
 * Public - verified by Stripe signature
 */
router.post('/webhooks/stripe', paymentController.handleStripeWebhook);

module.exports = router;
