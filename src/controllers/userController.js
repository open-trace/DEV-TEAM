/**
 * Get current user's profile
 * @route GET /api/users/me
 * @access Protected
 */
exports.getProfile = (req, res) => {
  // req.user is set by auth middleware
  res.json(req.user);
};
