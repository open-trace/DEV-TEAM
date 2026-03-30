const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { generateToken, generateVerificationToken, getVerificationTokenExpiry } = require('../utils/tokenUtils');
const { isValidEmail, isValidPassword, isValidName } = require('../utils/validators');
const { sendVerificationEmail } = require('./emailService');

const prisma = new PrismaClient();

/**
 * Register a new user
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @param {string} name - User's name (optional)
 * @returns {object} { success, token, user, message }
 */
const registerUser = async (email, password, name = null) => {
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
    const { name, email, password } = updates;
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

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
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
 * Delete user account
 * @param {string} userId - User's ID
 * @param {string} password - User's password for confirmation
 * @returns {object} { success, message }
 */
const deleteUser = async (userId, password) => {
  try {
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return { success: false, message: 'Incorrect password' };
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

module.exports = {
  registerUser,
  loginUser,
  updateUser,
  deleteUser,
  verifyEmail,
  resendVerificationEmail
};
