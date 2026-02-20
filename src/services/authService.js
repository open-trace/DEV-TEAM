const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { generateToken } = require('../utils/tokenUtils');
const { isValidEmail, isValidPassword, isValidName } = require('../utils/validators');

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

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name: name
      }
    });

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
      message: 'User registered successfully'
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

module.exports = {
  registerUser,
  loginUser,
  updateUser,
  deleteUser
};
