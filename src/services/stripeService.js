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

const activateSubscriptionFromStripePlan = async (subscription, stripeSubscriptionRef) => {
  const stripeSubscription = typeof stripeSubscriptionRef === 'string'
    ? await stripe.subscriptions.retrieve(stripeSubscriptionRef, {
        expand: ['items.data.price.product']
      })
    : stripeSubscriptionRef;

  const planDetails = await getSubscriptionPlanDetails(stripeSubscription);
  if (!planDetails?.planType) {
    throw new Error('Unable to determine subscription plan from Stripe');
  }

  const planConfig = subscriptionService.getPlanConfig(planDetails.planType);
  if (!planConfig) {
    throw new Error(`Invalid plan type from Stripe: ${planDetails.planType}`);
  }

  const renewalDate = stripeSubscription.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      planType: planDetails.planType,
      price: planDetails.price ?? planConfig.price,
      status: 'active',
      startDate: new Date(),
      renewalDate,
      queriesPerMonth: planConfig.queriesPerMonth,
      queriesUsedThisMonth: 0,
      monthResetDate: subscriptionService.getNextMonthResetDate(),
      updatedAt: new Date()
    }
  });
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

    const canActivateSubscription =
      subscription.status === 'pending' ||
      (subscription.status === 'active' && subscription.planType === 'Free' && subscription.stripeSubscriptionId);

    // Check if subscription still needs activation (prevent race condition with webhook)
    if (!canActivateSubscription) {
      throw new Error('Subscription already activated by webhook');
    }

    return activateSubscriptionFromStripePlan(subscription, subscription.stripeSubscriptionId);
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

    if (!subscription) {
      throw new Error('No subscription found');
    }

    // Free plan users cannot cancel - they can only upgrade
    if (subscription.planType === 'Free') {
      throw new Error('Free plan cannot be cancelled. Upgrade to a paid plan if you want to change your subscription.');
    }

    // Paid plan users require Stripe subscription ID
    if (!subscription.stripeSubscriptionId) {
      throw new Error('Paid subscription requires Stripe ID');
    }

    if (subscription.status === 'cancelled') {
      throw new Error('Subscription already cancelled');
    }

    if (subscription.status === 'past_due') {
      const cancelledSubscription = await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);

      const expiresAt = cancelledSubscription.ended_at
        ? new Date(cancelledSubscription.ended_at * 1000)
        : new Date();

      await prisma.subscription.update({
        where: { userId },
        data: {
          status: 'cancelled',
          expiryDate: expiresAt,
          updatedAt: new Date()
        }
      });

      return {
        cancelAtPeriodEnd: false,
        expiresAt
      };
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
 * @returns {object} Updated subscription or pending payment details
 */
exports.upgradeSubscription = async (userId, newPlanType) => {
  try {
    const planConfig = subscriptionService.getPlanConfig(newPlanType);
    if (!planConfig) {
      throw new Error(`Invalid plan type: ${newPlanType}`);
    }

    const newPrice = planConfig.price;
    const monthResetDate = subscriptionService.getNextMonthResetDate();

    const subscription = await prisma.subscription.findUnique({
      where: { userId }
    });

    if (!subscription) {
      throw new Error('No subscription found');
    }

    if (subscription.status !== 'active') {
      throw new Error('Subscription must be active to upgrade');
    }

    if (subscription.planType === newPlanType) {
      throw new Error(`You are already on the ${newPlanType} plan`);
    }

    // CASE 1: Upgrading FROM Free plan (no stripeSubscriptionId)
    if (subscription.planType === 'Free' || !subscription.stripeSubscriptionId) {
      // Get user email for Stripe customer creation
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user || !user.email) {
        throw new Error('User or user email not found');
      }

      const userEmail = user.email;

      // Create Stripe customer and subscription
      let stripeCustomerId;

      if (subscription.stripeCustomerId) {
        stripeCustomerId = subscription.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          email: userEmail,
          metadata: {
            userId,
            planType: newPlanType
          }
        });
        stripeCustomerId = customer.id;
      }

      // Get or create product and price
      let priceId;
      const products = await stripe.products.list({ limit: 100 });
      let product = products.data.find(p => p.metadata?.planType === newPlanType);

      if (!product) {
        product = await stripe.products.create({
          name: `Ask ADZA - ${newPlanType} Plan`,
          description: `${newPlanType} subscription for Ask ADZA`,
          metadata: { planType: newPlanType }
        });
      }

      const prices = await stripe.prices.list({
        product: product.id,
        limit: 100
      });
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

      // Create Stripe subscription
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

      // Get payment details
      const paymentDetails =
        (await resolvePaymentDetailsFromInvoice(stripeSubscription.latest_invoice)) ||
        (await waitForSubscriptionPaymentDetails(stripeSubscriptionId));

      if (!paymentDetails?.clientSecret) {
        throw new Error('Stripe did not create invoice payment details');
      }

      // Keep the current Free plan active until Stripe confirms the paid invoice.
      await prisma.subscription.update({
        where: { userId },
        data: {
          stripeCustomerId,
          stripeSubscriptionId,
          updatedAt: new Date()
        }
      });

      return {
        status: 'pending_payment',
        currentPlanType: subscription.planType,
        currentPrice: subscription.price,
        pendingPlanType: newPlanType,
        pendingPrice: newPrice,
        stripeSubscriptionId,
        clientSecret: paymentDetails.clientSecret,
        paymentIntentId: paymentDetails.paymentIntentId,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      };
    }

    // CASE 2: Upgrading between Paid plans (has stripeSubscriptionId)
    const products = await stripe.products.list({ limit: 100 });
    let product = products.data.find(p => p.metadata?.planType === newPlanType);

    if (!product) {
      product = await stripe.products.create({
        name: `Ask ADZA - ${newPlanType} Plan`,
        description: `${newPlanType} subscription for Ask ADZA`,
        metadata: { planType: newPlanType }
      });
    }

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
      const paymentDetails =
        (await resolvePaymentDetailsFromInvoice(stripeSubscription.latest_invoice)) ||
        (await waitForSubscriptionPaymentDetails(stripeSubscription.id));

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
        queriesPerMonth: planConfig.queriesPerMonth,
        queriesUsedThisMonth: 0,
        monthResetDate,
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

  if (!subscription) {
    return;
  }

  const canActivateSubscription =
    subscription.status === 'pending' ||
    (subscription.status === 'active' && subscription.planType === 'Free');

  if (!canActivateSubscription) {
    return;
  }

  await activateSubscriptionFromStripePlan(subscription, paymentIntent.subscription);
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

  const canActivateSubscription =
    subscription.status === 'pending' ||
    (subscription.status === 'active' && subscription.planType === 'Free');

  // Activate subscription if still pending, or promote Free after paid upgrade succeeds.
  if (canActivateSubscription) {
    await activateSubscriptionFromStripePlan(subscription, invoice.subscription);
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

  if (subscription.status === 'pending') {
    console.log(`Initial subscription payment failed, keeping pending: ${subscription.userId}`);
    return;
  }

  if (subscription.status === 'active' && subscription.planType === 'Free') {
    console.log(`Free-to-paid upgrade payment failed, leaving Free plan active: ${subscription.userId}`);
    return;
  }

  // A failed upgrade proration should leave the current active subscription unchanged.
  if (failedInvoice.billing_reason === 'subscription_update' && subscription.status === 'active') {
    console.log(`Subscription upgrade payment failed, leaving current plan unchanged: ${subscription.userId}`);
    return;
  }

  // Let Stripe keep retrying renewals during the recovery window.
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'past_due'
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

  if (subscription.status === 'active' && subscription.planType === 'Free') {
    if (updatedSub.status !== 'active') {
      return;
    }

    if (planDetails && planDetails.planType !== 'Free') {
      await activateSubscriptionFromStripePlan(subscription, updatedSub);
      return;
    }
  }

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
    // Get query tracking info for the new plan
    const planConfig = subscriptionService.getPlanConfig(planDetails.planType);
    const monthResetDate = subscriptionService.getNextMonthResetDate();

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planType: planDetails.planType,
        price: planDetails.price ?? subscription.price,
        status: 'active',
        queriesPerMonth: planConfig ? planConfig.queriesPerMonth : subscription.queriesPerMonth,
        queriesUsedThisMonth: 0,
        monthResetDate,
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

  if (subscription.status === 'cancelled') {
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
