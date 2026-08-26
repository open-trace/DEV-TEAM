const { verifyToken, isTokenBlacklisted } = require('../utils/tokenUtils');
const prisma = require('../utils/prismaClient');

// Routes a user without a country is still allowed to reach, so social-login
// users can complete their profile (and log out) before the gate lets them in.
const countryExemptRoutes = [
  { method: 'PATCH', path: '/api/users/country' }, // set their country (one-time)
  { method: 'GET', path: '/api/users/me' },        // read own profile / re-check state
  { method: 'POST', path: '/api/auth/logout' }     // log out
];

// Routes a user who has not completed onboarding is still allowed to reach.
// Onboarding is shown after a plan is picked, so plan selection and payment
// must stay open - otherwise the user is locked out of the very flow that
// leads to the onboarding form. Only the product itself is withheld.
const onboardingExemptRoutes = [
  ...countryExemptRoutes,
  { method: 'POST', path: '/api/users/onboarding' },  // complete onboarding
  { method: 'GET', path: '/api/users/settings' },     // theme etc. while onboarding
  { method: 'PUT', path: '/api/users/settings' },     // the onboarding page has a theme toggle
  { method: 'DELETE', path: '/api/users/me' },        // abandon the account entirely
  { method: 'POST', path: '/api/subscriptions/select' },
  { method: 'GET', path: '/api/subscriptions/current' },
  { method: 'GET', path: '/api/subscriptions/is-active' },
  { method: 'POST', path: '/api/payments/create-intent' },
  { method: 'POST', path: '/api/payments/confirm' },
  // An active Free user who goes back to pricing changes plan via upgrade,
  // not select, so this is still part of choosing a plan.
  { method: 'POST', path: '/api/payments/upgrade' }
];

/**
 * Check whether the current request is on an exempt list.
 * @param {object} req - Express request
 * @param {Array<{method: string, path: string}>} routes - Exempt routes
 * @returns {boolean} True if the request matches one of them
 */
const isExemptRoute = (req, routes) => {
  const requestPath = req.originalUrl.split('?')[0].replace(/\/$/, '');
  return routes.some((route) => route.method === req.method && route.path === requestPath);
};

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
const auth = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Check if token is blacklisted (logged out)
    if (isTokenBlacklisted(token)) {
      return res.status(401).json({ error: 'Token has been invalidated. Please login again.' });
    }

    // Verify token
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, country: true, termsAcceptedAt: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Country gate: users without a country (e.g. new social-login users) must
    // set it before using the app. Block protected routes except the ones they
    // need to complete their profile.
    if (!user.country && !isExemptRoute(req, countryExemptRoutes)) {
      return res.status(403).json({
        error: 'A country is required before you can use the app',
        code: 'COUNTRY_REQUIRED'
      });
    }

    // Onboarding gate: the acknowledgements on the onboarding form are required,
    // so the product stays closed until they are given. Signing up, paying and
    // leaving all remain possible - see onboardingExemptRoutes.
    if (!user.termsAcceptedAt && !isExemptRoute(req, onboardingExemptRoutes)) {
      return res.status(403).json({
        error: 'Please complete onboarding before you can use the app',
        code: 'ONBOARDING_REQUIRED'
      });
    }

    // Attach user and token to request
    req.user = user;
    req.token = token;

    // Continue to next middleware/route
    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = auth;
