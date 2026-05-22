const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generatePlayoffs }        = require('../services/tournament');
const { computeCompetitionLeaderboard } = require('../services/leaderboard');

// GET /api/competitions
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM competitions ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/competitions/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM competitions WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/competitions  (chief_judge | admin)
// Раздел 3.1.3: создание соревнования и Положение — функция оргкомитета во главе
// с главным судьёй, не только администратора платформы.
router.post('/', authenticate, authorize('chief_judge', 'admin'), async (req, res) => {
  const { name, location, start_date, end_date, playoff_size } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO competitions (name, location, start_date, end_date, playoff_size, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, location, start_date, end_date, playoff_size || 16, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/competitions/:id  (chief_judge | admin)
router.patch('/:id', authenticate, authorize('chief_judge', 'admin'), async (req, res) => {
  const allowed = [
    'name', 'location', 'start_date', 'end_date', 'status', 'playoff_size',
    'discipline_id', 'race_system_id', 'race_format_id', 'age_group_id',
    'gender', 'entry_fee_rub', 'registration_deadline', 'organizer_id',
    'venue_address',
  ];
  const updates = [];
  const values  = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      values.push(req.body[f]);
      updates.push(`${f} = $${values.length}`);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE competitions SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/competitions/:id  (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM competitions WHERE id = $1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/competitions/:id/bracket
// GET /api/competitions/:id/leaderboard?limit=N — live spectator standings.
router.get('/:id/leaderboard', authenticate, async (req, res) => {
  try {
    const competitionId = parseInt(req.params.id, 10);
    const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit, 10) || 0) : null;
    const board = await computeCompetitionLeaderboard(competitionId, { limit });
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/bracket', authenticate, async (req, res) => {
  try {
    const compRes = await pool.query('SELECT * FROM competitions WHERE id=$1', [req.params.id]);
    if (!compRes.rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: brackets } = await pool.query(`
      SELECT
        pb.*,
        p.first_name, p.last_name, p.team,
        r.time_seconds, r.total_time, r.penalty_seconds, r.dnf, r.dsq
      FROM playoff_brackets pb
      LEFT JOIN pilots  p ON p.id = pb.pilot_id
      LEFT JOIN results r ON r.pilot_id = pb.pilot_id AND r.heat_id = pb.heat_id
      WHERE pb.competition_id = $1
      ORDER BY
        CASE pb.round_type
          WHEN 'quarterfinal' THEN 1
          WHEN 'semifinal'    THEN 2
          WHEN 'bronze_final' THEN 3
          WHEN 'final'        THEN 4
        END,
        pb.bracket_slot
    `, [req.params.id]);

    const { rows: qual } = await pool.query(`
      SELECT p.id, p.first_name, p.last_name, p.team,
             MIN(r.total_time) AS best_time
      FROM pilots p
      JOIN results r ON r.pilot_id = p.id
      JOIN heats   h ON h.id = r.heat_id
      WHERE h.competition_id = $1
        AND h.round_type = 'qualification'
        AND h.status = 'locked'
        AND r.total_time IS NOT NULL
      GROUP BY p.id
      ORDER BY best_time
    `, [req.params.id]);

    res.json({ competition: compRes.rows[0], brackets, qual_leaderboard: qual });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/competitions/:id/generate-playoffs  (chief_judge | admin)
router.post(
  '/:id/generate-playoffs',
  authenticate,
  authorize('chief_judge', 'admin'),
  async (req, res) => {
    try {
      const bracket = await generatePlayoffs(parseInt(req.params.id, 10));
      res.json(bracket);
    } catch (err) {
      res.status(422).json({ error: err.message });
    }
  }
);

module.exports = router;
