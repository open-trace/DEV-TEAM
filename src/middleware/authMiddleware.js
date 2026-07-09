const { verifyToken, isTokenBlacklisted } = require('../utils/tokenUtils');
const prisma = require('../utils/prismaClient');

// Routes a user without a country is still allowed to reach, so social-login
// users can complete their profile (and log out) before the gate lets them in.
const countryExemptRoutes = [
  { method: 'PATCH', path: '/api/users/country' }, // set their country (one-time)
  { method: 'GET', path: '/api/users/me' },        // read own profile / re-check state
  { method: 'POST', path: '/api/auth/logout' }     // log out
];

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
      select: { id: true, email: true, name: true, country: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Country gate: users without a country (e.g. new social-login users) must
    // set it before using the app. Block protected routes except the ones they
    // need to complete their profile.
    if (!user.country) {
      const requestPath = req.originalUrl.split('?')[0].replace(/\/$/, '');
      const isExempt = countryExemptRoutes.some(
        (route) => route.method === req.method && route.path === requestPath
      );

      if (!isExempt) {
        return res.status(403).json({
          error: 'A country is required before you can use the app',
          code: 'COUNTRY_REQUIRED'
        });
      }
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
