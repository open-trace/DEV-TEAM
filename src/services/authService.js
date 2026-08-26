const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { OAuth2Client } = require('google-auth-library');
const { generateToken, generateVerificationToken, getVerificationTokenExpiry } = require('../utils/tokenUtils');
const { isValidEmail, isValidPassword, isValidName, normalizeCountry } = require('../utils/validators');
const { sendVerificationEmail, sendPasswordResetEmail } = require('./emailService');
const stripeService = require('./stripeService');

const prisma = new PrismaClient();

// Google OAuth client IDs allowed to authenticate (comma-separated to support
// multiple platforms later, e.g. web + Android + iOS). A token is accepted only
// if its `aud` claim matches one of these.
const googleClientIds = (process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const googleOAuthClient = new OAuth2Client();

/**
 * Verify a Google ID token against our allowed client IDs.
 * Shared by Google sign-in and by social-account deletion confirmation.
 * @param {string} idToken - Google ID token from the frontend
 * @returns {object} { success, payload, message }
 */
const verifyGoogleToken = async (idToken) => {
  if (!idToken) {
    return { success: false, message: 'Google ID token is required' };
  }

  if (googleClientIds.length === 0) {
    console.error('GOOGLE_CLIENT_ID is not configured');
    return { success: false, message: 'Google sign-in is not configured' };
  }

  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken,
      audience: googleClientIds
    });
    return { success: true, payload: ticket.getPayload() };
  } catch (verifyError) {
    console.error('Google token verification failed:', verifyError.message);
    return { success: false, message: 'Invalid or expired Google token' };
  }
};

/**
 * Register a new user
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @param {string} name - User's name (optional)
 * @param {string} country - User's country (required; set once, never updated)
 * @returns {object} { success, token, user, message }
 */
const registerUser = async (email, password, name = null, country = null) => {
  try {
    // Validate email
    if (!isValidEmail(email)) {
      return { success: false, message: 'Invalid email format' };
    }

    // Validate password
    const passwordValidation = isValidPassword(password);
    if (!passwordValidation.isValid) {
      return { success: false, message: passwordValidation.message };
    }

    // Validate name if provided
    if (name && !isValidName(name)) {
      return { success: false, message: 'Name must be between 2 and 50 characters' };
    }

    // Validate country (required; used for plan/country-based access control)
    const canonicalCountry = normalizeCountry(country);
    if (!canonicalCountry) {
      return { success: false, message: 'A valid country is required' };
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return { success: false, message: 'User already exists with this email' };
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate email verification token and expiry (24 hours)
    const verificationToken = generateVerificationToken();
    const verificationExpiry = getVerificationTokenExpiry();

    // Create unverified user with verification token
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name: name,
        country: canonicalCountry,
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpiry
      }
    });

    // Send verification email
    try {
      await sendVerificationEmail({
        toEmail: user.email,
        name: user.name,
        verificationToken: verificationToken
      });
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Don't fail registration if email send fails - user can request resend later
    }

    // Return success (user NOT logged in yet - must verify email first)
    return {
      success: true,
      message: 'Registration successful! Check your email to verify your account.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        country: user.country,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt
      }
    };

  } catch (error) {
    console.error('Registration error:', error);
    return { success: false, message: 'Registration failed. Please try again.' };
  }
};

/**
 * Login user
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @returns {object} { success, token, user, message }
 */
const loginUser = async (email, password) => {
  try {
    // Validate inputs
    if (!email || !password) {
      return { success: false, message: 'Email and password are required' };
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return { success: false, message: 'Invalid email or password' };
    }

    // Check if email is verified
    if (!user.emailVerified) {
      return { success: false, message: 'Please verify your email before logging in' };
    }

    // Social-login accounts (e.g. Google) have no password stored. Guide them to
    // the correct sign-in method instead of attempting a password comparison.
    if (!user.password) {
      return { success: false, message: 'This account uses Google sign-in. Please continue with Google.' };
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return { success: false, message: 'Invalid email or password' };
    }

    // Generate token
    const token = generateToken(user.id);

    // Return success (exclude password from response)
    return {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        country: user.country,
        createdAt: user.createdAt
      },
      message: 'Login successful'
    };

  } catch (error) {
    console.error('Login error:', error);
    return { success: false, message: 'Login failed. Please try again.' };
  }
};

/**
 * Update user profile
 * @param {string} userId - User's ID
 * @param {object} updates - Fields to update (name, email, password)
 * @returns {object|null} Updated user or null if email conflict
 */
const updateUser = async (userId, updates) => {
  try {
    const { name, email, password, organization, profession, intendedUsage } = updates;
    const updateData = {};

    // Add name if provided
    if (name !== undefined) {
      updateData.name = name;
    }

    // Add email if provided (check for duplicates)
    if (email !== undefined) {
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });

      // If email exists and belongs to another user
      if (existingUser && existingUser.id !== userId) {
        return null; // Email conflict
      }

      updateData.email = email;
    }

    // Hash password if provided
    if (password !== undefined) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    // Onboarding fields. An empty organization clears it back to null so the
    // column never holds an empty string alongside genuine nulls.
    if (organization !== undefined) {
      // null or blank both mean "no organization"; store null either way.
      updateData.organization =
        typeof organization === 'string' ? organization.trim() || null : null;
    }

    if (profession !== undefined) {
      updateData.profession = profession;
    }

    if (intendedUsage !== undefined) {
      updateData.intendedUsage = intendedUsage.trim();
    }

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        country: true,
        organization: true,
        profession: true,
        intendedUsage: true,
        createdAt: true
      }
    });

    return updatedUser;

  } catch (error) {
    console.error('Update user error:', error);
    throw error;
  }
};

/**
 * Delete user account. Identity is re-confirmed before this irreversible action:
 *  - Password-based accounts (local or linked) confirm with their password.
 *  - Social-only accounts (no password) confirm with a fresh Google ID token
 *    whose `sub` must match the account's stored googleId.
 * @param {string} userId - User's ID
 * @param {object} confirmation - { password, idToken }
 * @returns {object} { success, message }
 */
const deleteUser = async (userId, { password, idToken } = {}) => {
  try {
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    if (user.password) {
      // Password-based account (email/password, or a social account that later
      // added a password): confirm with the password.
      if (!password) {
        return { success: false, message: 'Password is required to delete account' };
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return { success: false, message: 'Incorrect password' };
      }
    } else if (user.googleId) {
      // Social-only account: re-authenticate with a fresh Google token and make
      // sure it belongs to the same Google account.
      if (!idToken) {
        return { success: false, message: 'Google confirmation is required to delete this account' };
      }

      const verification = await verifyGoogleToken(idToken);
      if (!verification.success) {
        return { success: false, message: verification.message };
      }

      if (verification.payload.sub !== user.googleId) {
        return { success: false, message: 'Google account does not match this account' };
      }
    } else {
      // Neither a password nor a linked Google account — no way to confirm.
      return { success: false, message: 'Unable to verify identity for this account' };
    }

    // Stop billing before the account disappears. If this fails we must NOT delete the
    // user: doing so would destroy the only record of a subscription that is still
    // charging their card, leaving them no way to cancel it.
    try {
      const cancellation = await stripeService.cancelSubscriptionForAccountDeletion(userId);

      // Once the user row is gone this log is the only record on our side that the
      // subscription was cancelled, so keep it even when there was nothing to cancel.
      console.log(
        cancellation.cancelled
          ? `Account deletion cancelled Stripe subscription ${cancellation.stripeSubscriptionId} for user ${userId}`
          : `Account deletion for user ${userId}: no live Stripe subscription to cancel`
      );
    } catch (stripeError) {
      console.error('Delete user - Stripe cancellation failed:', stripeError);
      throw new Error('Unable to cancel the subscription with the payment provider');
    }

    // Delete user (chats and messages will cascade delete)
    await prisma.user.delete({
      where: { id: userId }
    });

    return { success: true, message: 'Account deleted successfully' };

  } catch (error) {
    console.error('Delete user error:', error);
    throw error;
  }
};

/**
 * Verify user email with verification token
 * @param {string} verificationToken - Token from email link
 * @returns {object} { success, message, user }
 */
const verifyEmail = async (verificationToken) => {
  try {
    if (!verificationToken) {
      return { success: false, message: 'Verification token is required' };
    }

    // Find user by verification token
    const user = await prisma.user.findUnique({
      where: { emailVerificationToken: verificationToken }
    });

    if (!user) {
      return { success: false, message: 'Invalid or expired verification link' };
    }

    // Check if token has expired
    if (!user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return { success: false, message: 'Verification link has expired. Please request a new one.' };
    }

    // Check if already verified
    if (user.emailVerified) {
      return { success: false, message: 'Email is already verified' };
    }

    // Mark email as verified and clear token
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null
      },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        createdAt: true
      }
    });

    return {
      success: true,
      message: 'Email verified successfully! You can now log in.',
      user: updatedUser
    };

  } catch (error) {
    console.error('Email verification error:', error);
    return { success: false, message: 'Email verification failed. Please try again.' };
  }
};

/**
 * Resend verification email for unverified users
 * @param {string} email - User email
 * @returns {object} { success, message }
 */
const resendVerificationEmail = async (email) => {
  try {
    if (!email) {
      return { success: false, message: 'Email is required' };
    }

    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    // Generic response to avoid exposing account existence
    if (!user) {
      return { success: true, message: 'If the email exists, a verification link has been sent.' };
    }

    if (user.emailVerified) {
      return { success: false, message: 'Email is already verified' };
    }

    const verificationToken = generateVerificationToken();
    const verificationExpiry = getVerificationTokenExpiry();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpiry
      }
    });

    await sendVerificationEmail({
      toEmail: user.email,
      name: user.name,
      verificationToken
    });

    return { success: true, message: 'Verification email sent. Please check your inbox.' };
  } catch (error) {
    console.error('Resend verification email error:', error);
    return { success: false, message: 'Could not resend verification email. Please try again.' };
  }
};

/**
 * Request password reset for user
 * @param {string} email - User email
 * @returns {object} { success, message }
 */
const requestPasswordReset = async (email) => {
  try {
    if (!email) {
      return { success: false, message: 'Email is required' };
    }

    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    // Generic response to avoid exposing account existence
    if (!user) {
      return { success: true, message: 'If the email exists, a password reset link has been sent.' };
    }

    // Generate reset token and expiry (1 hour)
    const resetToken = generateVerificationToken();
    const resetExpiry = new Date();
    resetExpiry.setHours(resetExpiry.getHours() + 1);

    // Save token to database
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpiry
      }
    });

    // Send password reset email
    try {
      await sendPasswordResetEmail({
        toEmail: user.email,
        name: user.name,
        resetToken: resetToken
      });
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
      return { success: false, message: 'Could not send reset email. Please try again.' };
    }

    return { success: true, message: 'If the email exists, a password reset link has been sent.' };
  } catch (error) {
    console.error('Password reset request error:', error);
    return { success: false, message: 'Password reset request failed. Please try again.' };
  }
};

/**
 * Reset user password with token
 * @param {string} resetToken - Reset token from email
 * @param {string} newPassword - New password
 * @returns {object} { success, message }
 */
const resetUserPassword = async (resetToken, newPassword) => {
  try {
    if (!resetToken) {
      return { success: false, message: 'Reset token is required' };
    }

    if (!newPassword) {
      return { success: false, message: 'New password is required' };
    }

    // Validate password
    const passwordValidation = isValidPassword(newPassword);
    if (!passwordValidation.isValid) {
      return { success: false, message: passwordValidation.message };
    }

    // Find user by reset token
    const user = await prisma.user.findUnique({
      where: { passwordResetToken: resetToken }
    });

    if (!user) {
      return { success: false, message: 'Invalid or expired reset link' };
    }

    // Check if token has expired
    if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      return { success: false, message: 'Reset link has expired. Please request a new one.' };
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password and clear reset token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null
      }
    });

    return { success: true, message: 'Password has been reset successfully. You can now log in with your new password.' };
  } catch (error) {
    console.error('Password reset error:', error);
    return { success: false, message: 'Password reset failed. Please try again.' };
  }
};

/**
 * Authenticate (or register) a user via a Google ID token.
 *
 * Flow:
 *  1. Cryptographically verify the ID token against our allowed client IDs.
 *  2. Require Google to have verified the email (email_verified === true).
 *  3. Find-or-create:
 *     - match by googleId  -> log in existing Google user
 *     - match by email     -> auto-link Google to the existing account
 *     - no match           -> create a new social account (no password,
 *                             country null until the user sets it)
 *
 * @param {string} idToken - Google ID token sent by the frontend
 * @returns {object} { success, token, user, profileComplete, message }
 */
const socialLoginGoogle = async (idToken) => {
  try {
    // Verify the token signature, expiry, issuer and audience against Google.
    const verification = await verifyGoogleToken(idToken);
    if (!verification.success) {
      return { success: false, message: verification.message };
    }
    const payload = verification.payload;

    const googleId = payload.sub;
    const email = payload.email ? payload.email.toLowerCase() : null;
    const emailVerified = payload.email_verified === true;
    const name = payload.name || null;

    if (!googleId || !email) {
      return { success: false, message: 'Google account is missing required profile information' };
    }

    // Only trust the email if Google itself verified it. This also protects
    // account auto-linking from being abused with an unverified address.
    if (!emailVerified) {
      return { success: false, message: 'Your Google email is not verified. Please use a verified Google account.' };
    }

    // 1. Existing Google user (already linked)?
    let user = await prisma.user.findUnique({ where: { googleId } });

    // 2. Otherwise, an existing account with the same email -> link it.
    if (!user) {
      const existingByEmail = await prisma.user.findUnique({ where: { email } });

      if (existingByEmail) {
        user = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: {
            googleId,
            // Google has verified this email, so mark it verified if it wasn't.
            emailVerified: true
          }
        });
      } else {
        // 3. Brand new social user. No password; country stays null until the
        // user sets it (enforced later by the country gate). emailVerified is
        // true because Google vouched for the address.
        user = await prisma.user.create({
          data: {
            email,
            name,
            provider: 'google',
            googleId,
            emailVerified: true,
            password: null,
            country: null
          }
        });
      }
    }

    const token = generateToken(user.id);

    return {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        country: user.country,
        createdAt: user.createdAt
      },
      // Frontend uses this to decide whether to show the "choose country" step.
      profileComplete: Boolean(user.country),
      message: 'Google sign-in successful'
    };
  } catch (error) {
    console.error('Google sign-in error:', error);
    return { success: false, message: 'Google sign-in failed. Please try again.' };
  }
};

module.exports = {
  registerUser,
  loginUser,
  updateUser,
  deleteUser,
  verifyEmail,
  resendVerificationEmail,
  requestPasswordReset,
  resetUserPassword,
  socialLoginGoogle
};
