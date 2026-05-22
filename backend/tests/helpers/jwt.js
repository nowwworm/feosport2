'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_do_not_use_in_production';

/**
 * Generate a valid JWT token for testing
 */
function generateToken(userId, role, expiresIn = '1h') {
  return jwt.sign(
    { id: userId, role },
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Verify a JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Create an Authorization header value
 */
function authHeader(userId, role) {
  const token = generateToken(userId, role);
  return `Bearer ${token}`;
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  authHeader
};
