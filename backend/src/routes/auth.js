const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
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

// POST /api/auth/register  (admin-only in production)
router.post('/register', async (req, res) => {
  const { email, password, role_id } = req.body;
  if (!email || !password || !role_id) {
    return res.status(400).json({ error: 'email, password, role_id required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role_id)
       VALUES ($1, $2, $3)
       RETURNING id, email, role_id`,
      [email.toLowerCase(), hash, role_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
