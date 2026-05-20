const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'feosport2_dev_secret_change_in_prod';

/**
 * Verifies Bearer JWT and attaches decoded payload to req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
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
