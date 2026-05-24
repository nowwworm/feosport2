const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const DEFAULT_JWT_SECRET = process.env.NODE_ENV === 'test'
  ? 'test_secret_key_do_not_use_in_production'
  : 'feosport2_dev_secret_change_in_prod';

const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

/**
 * Verifies Bearer JWT, validates user status in DB, and attaches payload to req.user.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Validate user in DB
    const { rows } = await pool.query(
      `SELECT u.is_active, r.name AS role 
       FROM users u 
       JOIN roles r ON r.id = u.role_id 
       WHERE u.id = $1`,
      [decoded.id]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'User is deactivated or deleted' });
    }

    req.user = {
      ...decoded,
      role: rows[0].role // Ensure we have the freshest role
    };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('[auth middleware]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Restrict endpoint to specific roles.
 * Usage: router.patch('/lock', authenticate, authorize('chief_judge', 'admin'), handler)
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authenticate, authorize, JWT_SECRET };
