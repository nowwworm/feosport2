'use strict';

// Teams API — for командные дисциплины (5.5.8).
// CRUD + member management with captain invariant (one per team).

const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const VALID_ROLES = ['pilot', 'mechanic', 'reserve'];

router.get('/', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT json_agg(json_build_object(
                  'id', tm.id,
                  'pilot_id', tm.pilot_id,
                  'role', tm.role,
                  'is_captain', tm.is_captain,
                  'first_name', p.first_name,
                  'last_name', p.last_name
              ) ORDER BY tm.is_captain DESC, tm.id)
                FROM team_members tm
                JOIN pilots p ON p.id = tm.pilot_id
               WHERE tm.team_id = t.id) AS members
         FROM teams t
        ORDER BY t.name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: members } = await pool.query(
      `SELECT tm.id, tm.pilot_id, tm.role, tm.is_captain, tm.joined_at,
              p.first_name, p.last_name
         FROM team_members tm
         JOIN pilots p ON p.id = tm.pilot_id
        WHERE tm.team_id = $1
        ORDER BY tm.is_captain DESC, tm.id`,
      [req.params.id]
    );
    res.json({ ...rows[0], members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teams  (admin or chief_judge)
router.post('/', authenticate, authorize('admin', 'chief_judge'), async (req, res) => {
  const { name, region, representative_user_id, coach_user_id, external_id } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO teams (name, region, representative_user_id, coach_user_id, external_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name.trim(), region || null, representative_user_id || null,
       coach_user_id || null, external_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Duplicate external_id' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/teams/:id
router.patch('/:id', authenticate, authorize('admin', 'chief_judge'), async (req, res) => {
  const fields = ['name', 'region', 'representative_user_id', 'coach_user_id', 'external_id'];
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
      `UPDATE teams SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teams/:id  (admin)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Members ─────────────────────────────────────────────────────────────────

// POST /api/teams/:id/members  { pilot_id, role, is_captain? }
router.post('/:id/members', authenticate, authorize('admin', 'chief_judge'), async (req, res) => {
  const { pilot_id, role, is_captain } = req.body;
  if (!pilot_id) return res.status(400).json({ error: 'pilot_id required' });
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: teamRows } = await client.query('SELECT id FROM teams WHERE id = $1', [req.params.id]);
    if (!teamRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Team not found' });
    }

    // Состав не более 3 человек (5.5.8.1.2).
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1',
      [req.params.id]
    );
    if (countRows[0].n >= 3) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Team already has 3 members' });
    }

    // Капитан — снимаем флаг с предыдущего, если назначаем нового.
    if (is_captain) {
      await client.query(
        'UPDATE team_members SET is_captain = false WHERE team_id = $1',
        [req.params.id]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO team_members (team_id, pilot_id, role, is_captain)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, pilot_id, role, !!is_captain]
    );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Pilot already in team' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/teams/:id/members/:memberId  { role?, is_captain? }
router.patch('/:id/members/:memberId', authenticate, authorize('admin', 'chief_judge'), async (req, res) => {
  const { role, is_captain } = req.body;
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (is_captain === true) {
      await client.query(
        'UPDATE team_members SET is_captain = false WHERE team_id = $1',
        [req.params.id]
      );
    }

    const updates = [];
    const values  = [];
    if (role !== undefined) { values.push(role);             updates.push(`role = $${values.length}`); }
    if (is_captain !== undefined) { values.push(!!is_captain); updates.push(`is_captain = $${values.length}`); }

    if (!updates.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields to update' });
    }
    values.push(req.params.memberId, req.params.id);
    const { rows } = await client.query(
      `UPDATE team_members SET ${updates.join(', ')}
        WHERE id = $${values.length - 1} AND team_id = $${values.length}
        RETURNING *`,
      values
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Member not found' });
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/teams/:id/members/:memberId
router.delete('/:id/members/:memberId', authenticate, authorize('admin', 'chief_judge'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM team_members WHERE id = $1 AND team_id = $2',
      [req.params.memberId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Member not found' });
    res.json({ deleted: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
