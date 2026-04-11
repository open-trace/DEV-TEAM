const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../utils/prismaClient');
const subscriptionService = require('./subscriptionService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const derivePaymentIntentIdFromClientSecret = (clientSecret) => {
  if (!clientSecret || typeof clientSecret !== 'string') {
    return null;
  }

  const [paymentIntentId] = clientSecret.split('_secret_');
  return paymentIntentId?.startsWith('pi_') ? paymentIntentId : null;
};

const getInvoicePaymentDetails = (invoice) => {
  if (!invoice) {
    return null;
  }

  const paymentIntent =
    typeof invoice.payment_intent === 'object' ? invoice.payment_intent : null;

  const clientSecret =
    paymentIntent?.client_secret ||
    invoice.confirmation_secret?.client_secret ||
    null;

  const paymentIntentId =
    paymentIntent?.id ||
    derivePaymentIntentIdFromClientSecret(clientSecret);

  if (!clientSecret && !paymentIntentId) {
    return null;
  }

  return {
    clientSecret,
    paymentIntentId
  };
};

const resolvePaymentDetailsFromInvoice = async (invoiceRef) => {
  if (!invoiceRef) {
    return null;
  }

  const existingDetails = getInvoicePaymentDetails(invoiceRef);
  if (existingDetails) {
    return existingDetails;
  }

  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef.id;
  if (!invoiceId) {
    return null;
  }

  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['payment_intent', 'confirmation_secret']
  });

  return getInvoicePaymentDetails(invoice);
};

const waitForSubscriptionPaymentDetails = async (stripeSubscriptionId, maxAttempts = 8, delayMs = 1500) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ['latest_invoice.payment_intent', 'latest_invoice.confirmation_secret']
    });

    const paymentDetails = await resolvePaymentDetailsFromInvoice(subscription.latest_invoice);
    if (paymentDetails?.clientSecret) {
      return paymentDetails;
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  return null;
};

const getSubscriptionPlanDetails = async (stripeSubscription) => {
  const subscriptionItem = stripeSubscription?.items?.data?.[0];
  const priceRef = subscriptionItem?.price;

  if (!priceRef) {
    return null;
  }

  const price = typeof priceRef === 'string'
    ? await stripe.prices.retrieve(priceRef, { expand: ['product'] })
    : priceRef.product
      ? priceRef
      : await stripe.prices.retrieve(priceRef.id, { expand: ['product'] });

  const product = typeof price.product === 'string'
    ? await stripe.products.retrieve(price.product)
    : price.product;

  const planType = product?.metadata?.planType;
  if (!planType) {
    return null;
  }

  return {
    planType,
    price: typeof price.unit_amount === 'number' ? price.unit_amount / 100 : null
  };
};

/**
 * Create a Stripe customer and subscription
 * @param {string} userId - User ID
 * @param {string} userEmail - User email
 * @param {string} planType - Subscription plan type
 * @param {number} price - Plan price in dollars
 * @returns {object} Stripe subscription and payment intent details
 */
exports.createPaymentIntent = async (userId, userEmail, planType, price) => {
  try {
    // Create or get Stripe customer
    let stripeCustomerId;
    const subscription = await prisma.subscription.findUnique({
      where: { userId }
    });

    if (subscription?.stripeCustomerId) {
      // Customer already exists
      stripeCustomerId = subscription.stripeCustomerId;
    } else {
      // Create new customer
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          userId,
          planType
        }
      });
      stripeCustomerId = customer.id;
    }

    // Create product and price (if not exists)
    // In production, these will be created once and reused
    let priceId;
    const products = await stripe.products.list({ limit: 100 });
    let product = products.data.find(p => p.metadata?.planType === planType);

    if (!product) {
      product = await stripe.products.create({
        name: `Ask ADZA - ${planType} Plan`,
        description: `${planType} subscription for Ask ADZA`,
        metadata: { planType }
      });
    }

    // Create recurring price
    const prices = await stripe.prices.list({
      product: product.id,
      limit: 100
    });
    const existingPrice = prices.data.find(p => p.unit_amount === price * 100);

    if (existingPrice) {
      priceId = existingPrice.id;
    } else {
      const priceObj = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(price * 100), // Convert to cents
        currency: 'usd',
        recurring: {
          interval: 'month',
          interval_count: 1
        }
      });
      priceId = priceObj.id;
    }

    // Create a new Stripe subscription
    const stripeSubscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription'
      },
      expand: ['latest_invoice.payment_intent', 'latest_invoice.confirmation_secret']
    });
    const stripeSubscriptionId = stripeSubscription.id;

    // Stripe can expose the invoice secret/payment intent asynchronously after subscription creation.
    const paymentDetails =
      (await resolvePaymentDetailsFromInvoice(stripeSubscription.latest_invoice)) ||
      (await waitForSubscriptionPaymentDetails(stripeSubscriptionId));

    if (!paymentDetails?.clientSecret) {
      throw new Error('Stripe did not create invoice payment details for the subscription');
    }

    // Update database with Stripe IDs
    await prisma.subscription.update({
      where: { userId },
      data: {
        stripeCustomerId,
        stripeSubscriptionId
      }
    });

    // Return payment details for frontend
    return {
      stripeCustomerId,
      stripeSubscriptionId,
      clientSecret: paymentDetails.clientSecret,
      paymentIntentId: paymentDetails.paymentIntentId,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    };
  } catch (error) {
    console.error('Stripe payment intent error:', error);
    throw new Error(`Failed to create payment intent: ${error.message}`);
  }
};

/**
 * Confirm payment and activate subscription
 * @param {string} userId - User ID
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @returns {object} Updated subscription
 */
exports.confirmPayment = async (userId, paymentIntentId) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { userId }
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Verify payment intent succeeded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      throw new Error(`Payment not successful: ${paymentIntent.status}`);
    }

    // Check if subscription is still pending (prevent race condition with webhook)
    if (subscription.status !== 'pending') {
      throw new Error('Subscription already activated by webhook');
    }

    // Update subscription status to active
    const updatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        status: 'active',
        startDate: new Date(),
        renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      }
    });

    return updatedSubscription;
  } catch (error) {
    console.error('Confirm payment error:', error);
    throw new Error(`Failed to confirm payment: ${error.message}`);
  }
};

/**
 * Schedule Stripe subscription cancellation at period end
 * @param {string} userId - User ID
 * @returns {object} Cancellation schedule details
 */
exports.cancelStripeSubscription = async (userId) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { userId }
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new Error('No subscription found');
    }

    if (subscription.status === 'cancelled') {
      throw new Error('Subscription already cancelled');
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);

    if (stripeSubscription.cancel_at_period_end) {
      const currentPeriodEnd = stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000)
        : subscription.renewalDate;

      await prisma.subscription.update({
        where: { userId },
        data: {
          status: 'active',
          expiryDate: currentPeriodEnd || subscription.expiryDate
        }
      });

      return {
        cancelAtPeriodEnd: true,
        expiresAt: currentPeriodEnd
      };
    }

    // Schedule Stripe subscription cancellation for the end of the current billing period
    const scheduledCancellation = await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    const expiresAt = scheduledCancellation.current_period_end
      ? new Date(scheduledCancellation.current_period_end * 1000)
      : subscription.renewalDate;

    await prisma.subscription.update({
      where: { userId },
      data: {
        status: 'active',
        expiryDate: expiresAt || subscription.expiryDate
      }
    });

    return {
      cancelAtPeriodEnd: true,
      expiresAt
    };
  } catch (error) {
    console.error('Cancel subscription error:', error);
    throw new Error(`Failed to cancel subscription: ${error.message}`);
  }
};

/**
 * Upgrade or change subscription plan
 * @param {string} userId - User ID
 * @param {string} newPlanType - New plan type
 * @returns {object} Updated subscription
 */
exports.upgradeSubscription = async (userId, newPlanType) => {
  try {
    const planConfig = subscriptionService.getPlanConfig(newPlanType);
    if (!planConfig) {
      throw new Error(`Invalid plan type: ${newPlanType}`);
    }

    const newPrice = planConfig.price;

    const subscription = await prisma.subscription.findUnique({
      where: { userId }
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new Error('No active subscription found');
    }

    if (subscription.status !== 'active') {
      throw new Error('Subscription must be active to upgrade');
    }

    // Get or create new price for the new plan
    const products = await stripe.products.list({ limit: 100 });
    let product = products.data.find(p => p.metadata?.planType === newPlanType);

    if (!product) {
      product = await stripe.products.create({
        name: `Ask ADZA - ${newPlanType} Plan`,
        description: `${newPlanType} subscription for Ask ADZA`,
        metadata: { planType: newPlanType }
      });
    }

    // Get or create price for new plan
    const prices = await stripe.prices.list({
      product: product.id,
      limit: 100
    });
    let priceId;
    const existingPrice = prices.data.find(p => p.unit_amount === newPrice * 100);

    if (existingPrice) {
      priceId = existingPrice.id;
    } else {
      const priceObj = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(newPrice * 100),
        currency: 'usd',
        recurring: {
          interval: 'month',
          interval_count: 1
        }
      });
      priceId = priceObj.id;
    }

    const currentStripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    );

    // Update subscription in Stripe and only apply the change if payment succeeds.
    const stripeSubscription = await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      {
        items: [
          {
            id: currentStripeSubscription.items.data[0].id,
            price: priceId
          }
        ],
        payment_behavior: 'pending_if_incomplete',
        proration_behavior: 'always_invoice',
        expand: ['latest_invoice.payment_intent', 'latest_invoice.confirmation_secret']
      }
    );

    if (stripeSubscription.pending_update) {
      const paymentDetails = stripeSubscription.latest_invoice
        ? await resolvePaymentDetailsFromInvoice(stripeSubscription.latest_invoice)
        : null;

      return {
        status: 'pending_payment',
        currentPlanType: subscription.planType,
        currentPrice: subscription.price,
        pendingPlanType: newPlanType,
        pendingPrice: newPrice,
        stripeSubscriptionId: stripeSubscription.id,
        clientSecret: paymentDetails?.clientSecret || null,
        paymentIntentId: paymentDetails?.paymentIntentId || null
      };
    }

    // Update local database
    const updatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        planType: newPlanType,
        price: newPrice,
        updatedAt: new Date()
      }
    });

    return {
      status: 'updated',
      subscription: updatedSubscription
    };
  } catch (error) {
    console.error('Upgrade subscription error:', error);
    throw new Error(`Failed to upgrade subscription: ${error.message}`);
  }
};

/**
 * Handle Stripe webhook events
 * @param {object} event - Stripe event from webhook
 * @returns {object} Processing result
 */
exports.handleWebhookEvent = async (event) => {
  try {
    const { type } = event;

    if (type === 'payment_intent.succeeded') {
      await handlePaymentIntentSucceeded(event);
    } else if (type === 'invoice.payment_succeeded') {
      await handleInvoicePaymentSucceeded(event);
    } else if (type === 'invoice.paid') {
      await handleInvoicePaid(event);
    } else if (type === 'invoice.payment_failed') {
      await handleInvoicePaymentFailed(event);
    } else if (type === 'customer.subscription.updated') {
      await handleSubscriptionUpdated(event);
    } else if (type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(event);
    } else {
      console.log(`Unhandled event type: ${type}`);
    }

    return { received: true };
  } catch (error) {
    console.error('Webhook error:', error);
    throw error;
  }
};

// Helper: Handle payment_intent.succeeded (initial payment)
const handlePaymentIntentSucceeded = async (event) => {
  const paymentIntent = event.data.object;

  // Only process subscription payments (one-time payments are ignored)
  if (!paymentIntent.subscription) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: paymentIntent.subscription }
  });

  if (!subscription || subscription.status !== 'pending') {
    return;
  }

  // Activate subscription (idempotent - only if pending)
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'active',
      startDate: new Date(),
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });
  console.log(`Subscription activated: ${paymentIntent.id}`);
};

// Helper: Handle invoice.payment_succeeded (renewal)
const handleInvoicePaymentSucceeded = async (event) => {
  const invoice = event.data.object;

  if (!invoice.subscription) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: invoice.subscription }
  });

  if (!subscription) {
    return;
  }

  // Update renewal date
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'active'
    }
  });
  console.log(`Subscription renewed: ${subscription.userId}`);
};

// Helper: Handle invoice.paid (subscription payment confirmed)
const handleInvoicePaid = async (event) => {
  const invoice = event.data.object;

  if (!invoice.subscription) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: invoice.subscription }
  });

  if (!subscription) {
    return;
  }

  // Activate subscription if still pending (for initial payment)
  if (subscription.status === 'pending') {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        startDate: new Date(),
        renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    console.log(`Subscription activated via invoice.paid: ${subscription.userId}`);
  }
};

// Helper: Handle invoice.payment_failed
const handleInvoicePaymentFailed = async (event) => {
  const failedInvoice = event.data.object;

  if (!failedInvoice.subscription) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: failedInvoice.subscription }
  });

  if (!subscription) {
    return;
  }

  // A failed upgrade proration should leave the current active subscription unchanged.
  if (failedInvoice.billing_reason === 'subscription_update' && subscription.status === 'active') {
    console.log(`Subscription upgrade payment failed, leaving current plan unchanged: ${subscription.userId}`);
    return;
  }

  // Mark as expired/failed
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'expired',
      expiryDate: new Date()
    }
  });
  console.log(`Subscription payment failed: ${subscription.userId}`);
};

// Helper: Handle customer.subscription.updated
const handleSubscriptionUpdated = async (event) => {
  const updatedSub = event.data.object;

  if (!updatedSub.id) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: updatedSub.id }
  });

  if (!subscription) {
    return;
  }

  const expiryDate = updatedSub.current_period_end
    ? new Date(updatedSub.current_period_end * 1000)
    : subscription.expiryDate;

  const planDetails = await getSubscriptionPlanDetails(updatedSub);

  if (updatedSub.cancel_at_period_end) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        planType: planDetails?.planType || subscription.planType,
        price: planDetails?.price ?? subscription.price,
        expiryDate
      }
    });
    return;
  }

  if (planDetails && (
    planDetails.planType !== subscription.planType ||
    planDetails.price !== subscription.price
  )) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planType: planDetails.planType,
        price: planDetails.price ?? subscription.price,
        status: 'active',
        updatedAt: new Date()
      }
    });
  }
};

// Helper: Handle customer.subscription.deleted
const handleSubscriptionDeleted = async (event) => {
  const deletedSub = event.data.object;

  if (!deletedSub.id) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: deletedSub.id }
  });

  if (!subscription) {
    return;
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'cancelled',
      expiryDate: deletedSub.ended_at
        ? new Date(deletedSub.ended_at * 1000)
        : new Date()
    }
  });
  console.log(`Subscription deleted: ${subscription.userId}`);
};

/**
 * Verify webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - Stripe signature header
 * @returns {object} Parsed event
 */
exports.verifyWebhookSignature = (body, signature) => {
  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    return event;
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    throw new Error('Webhook signature verification failed');
  }
};
