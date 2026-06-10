const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../utils/prismaClient');
const subscriptionService = require('./subscriptionService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_BILLING_FREQUENCY = 'monthly';

const getStripeUnitAmount = (price) => Math.round(Number(price) * 100);

const getFallbackRenewalDate = (billingOption) => {
  const renewalDate = new Date();
  renewalDate.setMonth(renewalDate.getMonth() + billingOption.billingPeriodMonths);
  return renewalDate;
};

const getDateFromStripeTimestamp = (timestamp) =>
  typeof timestamp === 'number' ? new Date(timestamp * 1000) : null;

const getCurrentPeriodEndDate = (stripeSubscription, fallbackDate = null) =>
  getDateFromStripeTimestamp(stripeSubscription?.items?.data?.[0]?.current_period_end) ||
  getDateFromStripeTimestamp(stripeSubscription?.current_period_end) ||
  fallbackDate;

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

const getStripeId = (value) => {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id || null;
};

const getSubscriptionIdFromInvoice = (invoice) => {
  const subscriptionFromInvoice =
    getStripeId(invoice?.subscription) ||
    getStripeId(invoice?.parent?.subscription_details?.subscription);

  if (subscriptionFromInvoice) {
    return subscriptionFromInvoice;
  }

  const subscriptionLine = invoice?.lines?.data?.find(
    (line) => line?.parent?.subscription_item_details?.subscription
  );

  return getStripeId(subscriptionLine?.parent?.subscription_item_details?.subscription);
};

const getInvoiceIdFromPaymentIntent = (paymentIntent) =>
  getStripeId(paymentIntent?.invoice) ||
  getStripeId(paymentIntent?.payment_details?.order_reference);

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

const getBillingFrequencyFromPrice = (price) => {
  const metadataFrequency = price?.metadata?.billingFrequency;
  if (metadataFrequency) {
    return String(metadataFrequency).trim().toLowerCase();
  }

  const interval = price?.recurring?.interval;
  const intervalCount = price?.recurring?.interval_count || 1;

  if (interval === 'month' && intervalCount === 3) {
    return 'quarterly';
  }

  if (interval === 'year' && intervalCount === 1) {
    return 'yearly';
  }

  return DEFAULT_BILLING_FREQUENCY;
};

const getBillingOptionForStripe = (planType, billingFrequency, priceOverride = null) => {
  const billingOption = subscriptionService.getBillingOption(planType, billingFrequency);

  if (!billingOption) {
    throw new Error(`Invalid plan type: ${planType}`);
  }

  return {
    ...billingOption,
    price: typeof priceOverride === 'number' ? priceOverride : billingOption.price
  };
};

const getOrCreateStripeProduct = async (planType) => {
  const products = await stripe.products.list({ limit: 100 });
  let product = products.data.find(p => p.metadata?.planType === planType);

  if (!product) {
    product = await stripe.products.create({
      name: `Ask ADZA - ${planType} Plan`,
      description: `${planType} subscription for Ask ADZA`,
      metadata: { planType }
    });
  }

  return product;
};

const stripePriceMatchesBillingOption = (price, billingOption) => {
  const intervalCount = price.recurring?.interval_count || 1;

  return (
    price.unit_amount === getStripeUnitAmount(billingOption.price) &&
    price.currency === 'usd' &&
    price.recurring?.interval === billingOption.interval &&
    intervalCount === billingOption.intervalCount
  );
};

const getOrCreateStripePrice = async (planType, billingOption) => {
  const product = await getOrCreateStripeProduct(planType);

  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100
  });

  const existingPrice = prices.data.find(price =>
    stripePriceMatchesBillingOption(price, billingOption)
  );

  if (existingPrice) {
    return existingPrice.id;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: getStripeUnitAmount(billingOption.price),
    currency: 'usd',
    recurring: {
      interval: billingOption.interval,
      interval_count: billingOption.intervalCount
    },
    metadata: {
      planType,
      billingFrequency: billingOption.billingFrequency,
      billingPeriodMonths: String(billingOption.billingPeriodMonths)
    }
  });

  return price.id;
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
    billingFrequency: getBillingFrequencyFromPrice(price),
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

  const billingOption = getBillingOptionForStripe(
    planDetails.planType,
    planDetails.billingFrequency || DEFAULT_BILLING_FREQUENCY
  );

  const renewalDate = getCurrentPeriodEndDate(
    stripeSubscription,
    getFallbackRenewalDate(billingOption)
  );

  return prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      planType: planDetails.planType,
      billingFrequency: billingOption.billingFrequency,
      price: planDetails.price ?? billingOption.price,
      status: 'active',
      startDate: new Date(),
      renewalDate,
      queriesPerMonth: planConfig.queriesPerMonth,
      usageCreditsPerMonth: planConfig.usageCreditsPerMonth,
      queriesUsedThisMonth: 0,
      usageCreditsUsedThisMonth: 0,
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
 * @param {number} price - Selected billing period price in dollars
 * @param {string} billingFrequency - Billing frequency (monthly, quarterly, yearly)
 * @returns {object} Stripe subscription and payment intent details
 */
exports.createPaymentIntent = async (
  userId,
  userEmail,
  planType,
  price,
  billingFrequency = DEFAULT_BILLING_FREQUENCY
) => {
  try {
    const billingOption = getBillingOptionForStripe(planType, billingFrequency, price);

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
          planType,
          billingFrequency: billingOption.billingFrequency
        }
      });
      stripeCustomerId = customer.id;
    }

    const priceId = await getOrCreateStripePrice(planType, billingOption);

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

    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
      { expand: ['items.data.price.product'] }
    );

    if (stripeSubscription.cancel_at_period_end) {
      const currentPeriodEnd = getCurrentPeriodEndDate(
        stripeSubscription,
        subscription.renewalDate
      );

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
      {
        cancel_at_period_end: true,
        expand: ['items.data.price.product']
      }
    );

    const expiresAt = getCurrentPeriodEndDate(
      scheduledCancellation,
      subscription.renewalDate
    );

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
 * @param {string} billingFrequency - Billing frequency (monthly, quarterly, yearly)
 * @returns {object} Updated subscription or pending payment details
 */
exports.upgradeSubscription = async (userId, newPlanType, billingFrequency = null) => {
  try {
    const planConfig = subscriptionService.getPlanConfig(newPlanType);
    if (!planConfig) {
      throw new Error(`Invalid plan type: ${newPlanType}`);
    }

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

    const billingOption = getBillingOptionForStripe(
      newPlanType,
      billingFrequency || subscription.billingFrequency || DEFAULT_BILLING_FREQUENCY
    );
    const newPrice = billingOption.price;
    const currentBillingFrequency = subscription.billingFrequency || DEFAULT_BILLING_FREQUENCY;

    if (
      subscription.planType === newPlanType &&
      currentBillingFrequency === billingOption.billingFrequency
    ) {
      throw new Error(`You are already on the ${newPlanType} ${billingOption.label} plan`);
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
            planType: newPlanType,
            billingFrequency: billingOption.billingFrequency
          }
        });
        stripeCustomerId = customer.id;
      }

      const priceId = await getOrCreateStripePrice(newPlanType, billingOption);

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
        currentBillingFrequency,
        pendingPlanType: newPlanType,
        pendingBillingFrequency: billingOption.billingFrequency,
        pendingPrice: newPrice,
        stripeSubscriptionId,
        clientSecret: paymentDetails.clientSecret,
        paymentIntentId: paymentDetails.paymentIntentId,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
      };
    }

    // CASE 2: Upgrading between Paid plans (has stripeSubscriptionId)
    const priceId = await getOrCreateStripePrice(newPlanType, billingOption);

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
        currentBillingFrequency,
        pendingPlanType: newPlanType,
        pendingBillingFrequency: billingOption.billingFrequency,
        pendingPrice: newPrice,
        stripeSubscriptionId: stripeSubscription.id,
        clientSecret: paymentDetails?.clientSecret || null,
        paymentIntentId: paymentDetails?.paymentIntentId || null
      };
    }

    const latestStripeSubscription = await stripe.subscriptions.retrieve(
      stripeSubscription.id,
      { expand: ['items.data.price.product'] }
    );
    const renewalDate = getCurrentPeriodEndDate(
      latestStripeSubscription,
      subscription.renewalDate
    );

    // Update local database
    const updatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        planType: newPlanType,
        billingFrequency: billingOption.billingFrequency,
        price: newPrice,
        renewalDate,
        queriesPerMonth: planConfig.queriesPerMonth,
        usageCreditsPerMonth: planConfig.usageCreditsPerMonth,
        queriesUsedThisMonth: 0,
        usageCreditsUsedThisMonth: 0,
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
  let stripeSubscriptionId = getStripeId(paymentIntent.subscription);

  if (!stripeSubscriptionId) {
    const invoiceId = getInvoiceIdFromPaymentIntent(paymentIntent);
    if (invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
    }
  }

  // Only process subscription payments (one-time payments are ignored).
  if (!stripeSubscriptionId) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId }
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

  await activateSubscriptionFromStripePlan(subscription, stripeSubscriptionId);
  console.log(`Subscription activated: ${paymentIntent.id}`);
};

// Helper: Handle invoice.payment_succeeded (renewal)
const handleInvoicePaymentSucceeded = async (event) => {
  const invoice = event.data.object;
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);

  if (!stripeSubscriptionId) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId }
  });

  if (!subscription) {
    return;
  }

  const canActivateSubscription =
    subscription.status === 'pending' ||
    (subscription.status === 'active' && subscription.planType === 'Free');

  if (canActivateSubscription) {
    await activateSubscriptionFromStripePlan(subscription, stripeSubscriptionId);
    console.log(`Subscription activated via invoice.payment_succeeded: ${subscription.userId}`);
    return;
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['items.data.price.product']
  });
  const renewalDate = getCurrentPeriodEndDate(stripeSubscription, subscription.renewalDate);

  // Keep query usage on its own monthly reset schedule; renewalDate follows Stripe's billing period.
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      renewalDate,
      status: 'active'
    }
  });
  console.log(`Subscription renewed: ${subscription.userId}`);
};

// Helper: Handle invoice.paid (subscription payment confirmed)
const handleInvoicePaid = async (event) => {
  const invoice = event.data.object;
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);

  if (!stripeSubscriptionId) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId }
  });

  if (!subscription) {
    return;
  }

  const canActivateSubscription =
    subscription.status === 'pending' ||
    (subscription.status === 'active' && subscription.planType === 'Free');

  // Activate subscription if still pending, or promote Free after paid upgrade succeeds.
  if (canActivateSubscription) {
    await activateSubscriptionFromStripePlan(subscription, stripeSubscriptionId);
    console.log(`Subscription activated via invoice.paid: ${subscription.userId}`);
  }
};

// Helper: Handle invoice.payment_failed
const handleInvoicePaymentFailed = async (event) => {
  const failedInvoice = event.data.object;
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(failedInvoice);

  if (!stripeSubscriptionId) {
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId }
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

  const currentPeriodEnd = getCurrentPeriodEndDate(updatedSub, subscription.renewalDate);

  const expiryDate = currentPeriodEnd
    ? currentPeriodEnd
    : subscription.expiryDate;

  const planDetails = await getSubscriptionPlanDetails(updatedSub);

  if (subscription.status === 'pending' && updatedSub.status === 'active') {
    await activateSubscriptionFromStripePlan(subscription, updatedSub);
    console.log(`Subscription activated via customer.subscription.updated: ${subscription.userId}`);
    return;
  }

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
        billingFrequency: planDetails?.billingFrequency || subscription.billingFrequency,
        price: planDetails?.price ?? subscription.price,
        renewalDate: currentPeriodEnd,
        expiryDate
      }
    });
    return;
  }

  if (planDetails && (
    planDetails.planType !== subscription.planType ||
    planDetails.billingFrequency !== subscription.billingFrequency ||
    planDetails.price !== subscription.price
  )) {
    // Get query tracking info for the new plan
    const planConfig = subscriptionService.getPlanConfig(planDetails.planType);
    const monthResetDate = subscriptionService.getNextMonthResetDate();

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planType: planDetails.planType,
        billingFrequency: planDetails.billingFrequency || subscription.billingFrequency,
        price: planDetails.price ?? subscription.price,
        status: 'active',
        renewalDate: currentPeriodEnd,
        queriesPerMonth: planConfig ? planConfig.queriesPerMonth : subscription.queriesPerMonth,
        usageCreditsPerMonth: planConfig ? planConfig.usageCreditsPerMonth : subscription.usageCreditsPerMonth,
        queriesUsedThisMonth: 0,
        usageCreditsUsedThisMonth: 0,
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
