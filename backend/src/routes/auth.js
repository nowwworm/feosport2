const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { z }  = require('zod');
const pool   = require('../config/db');
const { JWT_SECRET, authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const loginSchema = z.object({
  email: z.string().email('Invalid email format').min(1),
  password: z.string().min(1, 'Password is required')
});

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.string().optional(),
  role_id: z.number().int().positive().optional()
}).refine(data => data.role || data.role_id, {
  message: 'role or role_id is required',
  path: ['role']
});

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT u.*, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: rows[0].id, email: rows[0].email, role: rows[0].role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: rows[0].id, email: rows[0].email, role: rows[0].role } });
  } catch (err) {
    if (err.code === '28P01') {
      console.error(
        `[db] PostgreSQL authentication failed for DB_USER=${process.env.DB_USER || 'postgres'} ` +
        `DB_NAME=${process.env.DB_NAME || 'feosport2'} DB_HOST=${process.env.DB_HOST || 'localhost'}`
      );
    } else {
      console.error(err);
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/register  (admin-only)
// Body: { email, password, role | role_id }
//   - role: string ('admin'|'chief_judge'|'judge'|'pilot') — preferred
//   - role_id: integer — accepted for backwards compatibility
router.post('/register', authenticate, authorize('admin'), validate(registerSchema), async (req, res) => {
  const { email, password, role, role_id } = req.body;
  try {
    let effectiveRoleId = role_id;
    if (!effectiveRoleId) {
      const r = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
      if (!r.rows.length) return res.status(400).json({ error: `Unknown role: ${role}` });
      effectiveRoleId = r.rows[0].id;
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role_id)
       VALUES ($1, $2, $3)
       RETURNING id, email, role_id`,
      [email.toLowerCase(), hash, effectiveRoleId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
