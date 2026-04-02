const prisma = require('../utils/prismaClient');

/**
 * Available subscription plans with pricing
 */
const SUBSCRIPTION_PLANS = {
  Government: {
    name: 'Government & Public Institutions',
    price: 9.99,
    description: 'Understand production trends, regional risks, and food security pressures'
  },
  NGOs: {
    name: 'Foundations, NGOs & Development Partners',
    price: 9.99,
    description: 'Identify priority regions and monitor program relevance'
  },
  Agribusinesses: {
    name: 'Agribusinesses & Financial Institutions',
    price: 9.99,
    description: 'Assess production stability, market volatility, and regional risk exposure'
  },
  Farmers: {
    name: 'Farmers, Cooperatives & Communities',
    price: 9.99,
    description: 'Access clearer insights on changing conditions and market movements'
  },
  Integrated: {
    name: 'Integrated Account',
    price: 19.99,
    description: 'Access to all 4 stakeholder perspectives plus flexibility to choose answers'
  }
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
    description: value.description
  }));

  return plans;
};

/**
 * Select a subscription plan for a user
 * @param {string} userId - User's ID
 * @param {string} planType - Plan type (Government, NGOs, Agribusinesses, Farmers, Integrated)
 * @returns {object} Created or updated subscription
 */
exports.selectPlan = async (userId, planType) => {
  // Validate plan type
  if (!SUBSCRIPTION_PLANS[planType]) {
    throw new Error(`Invalid plan type: ${planType}`);
  }

  // Check if user already has a subscription
  const existingSubscription = await prisma.subscription.findUnique({
    where: { userId }
  });

  // If user has a PENDING subscription, allow them to change their plan selection
  if (existingSubscription?.status === 'pending') {
    const updatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        planType,
        price: SUBSCRIPTION_PLANS[planType].price
      }
    });
    return updatedSubscription;
  }

  // If user has an ACTIVE subscription, they must use switchPlan
  if (existingSubscription?.status === 'active') {
    throw new Error('You already have an active subscription. Use switchPlan to change plans.');
  }

  // If user has CANCELLED or EXPIRED subscription, allow reselection
  if (existingSubscription?.status === 'cancelled' || existingSubscription?.status === 'expired') {
    const reactivatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        planType,
        price: SUBSCRIPTION_PLANS[planType].price,
        status: 'pending'
      }
    });
    return reactivatedSubscription;
  }

  // Create new subscription with status "pending" (waiting for payment)
  const subscription = await prisma.subscription.create({
    data: {
      userId,
      planType,
      price: SUBSCRIPTION_PLANS[planType].price,
      status: 'pending' // Waiting for payment confirmation
    }
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
    where: { userId }
  });

  if (!subscription) {
    return null; // No subscription yet
  }

  // Include plan details
  const planDetails = SUBSCRIPTION_PLANS[subscription.planType];

  return {
    ...subscription,
    planName: planDetails.name,
    planDescription: planDetails.description,
    isActive: subscription.status === 'active'
  };
};

/**
 * Switch/upgrade subscription plan
 * @param {string} userId - User's ID
 * @param {string} newPlanType - New plan type
 * @returns {object} Updated subscription
 */
exports.switchPlan = async (userId, newPlanType) => {
  // Validate new plan type
  if (!SUBSCRIPTION_PLANS[newPlanType]) {
    throw new Error(`Invalid plan type: ${newPlanType}`);
  }

  // Get current subscription
  const currentSubscription = await prisma.subscription.findUnique({
    where: { userId }
  });

  if (!currentSubscription) {
    throw new Error('No existing subscription found. Use selectPlan to create one.');
  }

  // Don't allow switching if not active
  if (currentSubscription.status !== 'active') {
    throw new Error('Cannot switch plan. Current subscription is not active.');
  }

  // Update subscription to new plan
  const updatedSubscription = await prisma.subscription.update({
    where: { userId },
    data: {
      planType: newPlanType,
      price: SUBSCRIPTION_PLANS[newPlanType].price,
      updatedAt: new Date()
      // Note: In production, this would trigger a prorating calculation or billing event
    }
  });

  return updatedSubscription;
};

/**
 * Activate subscription (after payment confirmation)
 * @param {string} userId - User's ID
 * @returns {object} Activated subscription
 */
exports.activateSubscription = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId }
  });

  if (!subscription) {
    throw new Error('No subscription found');
  }

  // Update status to active and set renewal date (30 days from now)
  // Note: In production, this would process the initial payment charge
  const renewalDate = new Date();
  renewalDate.setDate(renewalDate.getDate() + 30);

  const activatedSubscription = await prisma.subscription.update({
    where: { userId },
    data: {
      status: 'active',
      startDate: new Date(),
      renewalDate
    }
  });

  return activatedSubscription;
};

/**
 * Cancel subscription
 * @param {string} userId - User's ID
 * @returns {object} Cancelled subscription
 */
exports.cancelSubscription = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId }
  });

  if (!subscription) {
    throw new Error('No subscription found');
  }

  const cancelledSubscription = await prisma.subscription.update({
    where: { userId },
    data: {
      status: 'cancelled',
      expiryDate: new Date()
    }
  });

  return cancelledSubscription;
};

/**
 * Check if subscription is active
 * @param {string} userId - User's ID
 * @returns {boolean} True if active, false otherwise
 */
exports.isSubscriptionActive = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId }
  });

  return subscription?.status === 'active';
};
