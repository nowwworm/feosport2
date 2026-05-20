const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/heats?competition_id=X&round_type=qualification
router.get('/', authenticate, async (req, res) => {
  const { competition_id, round_type } = req.query;
  const params = [];
  let where = 'WHERE 1=1';
  if (competition_id) {
    params.push(competition_id);
    where += ` AND h.competition_id = $${params.length}`;
  }
  if (round_type) {
    params.push(round_type);
    where += ` AND h.round_type = $${params.length}`;
  }
  try {
    const { rows } = await pool.query(
      `SELECT h.*,
              COALESCE(
                json_agg(
                  json_build_object('pilot_id', hp.pilot_id, 'lane', hp.lane)
                ) FILTER (WHERE hp.pilot_id IS NOT NULL),
                '[]'
              ) AS participants
       FROM heats h
       LEFT JOIN heat_participants hp ON hp.heat_id = h.id
       ${where}
       GROUP BY h.id
       ORDER BY h.heat_number`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/heats/:id/results
router.get('/:id/results', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.first_name, p.last_name, p.team
       FROM results r JOIN pilots p ON p.id = r.pilot_id
       WHERE r.heat_id = $1
       ORDER BY r.total_time ASC NULLS LAST`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/heats  (chief_judge | admin)
router.post('/', authenticate, authorize('chief_judge', 'admin'), async (req, res) => {
  const { competition_id, round_type, heat_number, judge_id, scheduled_at } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO heats (competition_id, round_type, heat_number, judge_id, scheduled_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [competition_id, round_type, heat_number, judge_id || null, scheduled_at || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Heat already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/heats/:id/lock  (chief_judge | admin)
router.patch('/:id/lock', authenticate, authorize('chief_judge', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE heats SET
         status     = 'locked',
         locked_at  = NOW(),
         locked_by  = $1,
         updated_at = NOW()
       WHERE id = $2 AND status != 'locked'
       RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Heat not found or already locked' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
