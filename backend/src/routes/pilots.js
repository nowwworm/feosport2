const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/pilots
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pilots ORDER BY last_name, first_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pilots/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pilots WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pilots  (admin only)
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const { first_name, last_name, middle_name, birth_date, team, city, video_channel, external_id } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO pilots
         (first_name, last_name, middle_name, birth_date, team, city, video_channel, external_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [first_name, last_name, middle_name || null, birth_date || null,
       team || null, city || null, video_channel || null, external_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/pilots/:id  (admin only)
router.patch('/:id', authenticate, authorize('admin'), async (req, res) => {
  const fields = ['first_name','last_name','middle_name','birth_date','team','city','video_channel'];
  const updates = [];
  const values  = [];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) {
      values.push(req.body[f]);
      updates.push(`${f} = $${values.length}`);
    }
  });
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE pilots SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pilots/fd-all  — удалить всех пришедших из FormDesigner (admin)
router.delete('/fd-all', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM pilots WHERE external_id IS NOT NULL'
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pilots/:id  (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM pilots WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
