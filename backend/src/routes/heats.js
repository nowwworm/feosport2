const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const {
  summarizeLaps,
  shouldRequestWholeGroupReflight,
  classifyReflightImpact,
  detectChannelConflicts,
} = require('../services/flightTiming');
const { computeHeatLeaderboard } = require('../services/leaderboard');

// Heat reads are scoped to judging/admin roles — pilots use the dedicated
// leaderboard endpoints instead (см. §2.4.2 — пилоты получают информацию
// о результатах через табло/секретариат, а не через служебный API судей).
const judgesOnly = authorize('judge', 'chief_judge', 'admin');

// GET /api/heats?competition_id=X&round_type=qualification
router.get('/', authenticate, judgesOnly, async (req, res) => {
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

// GET /api/heats/:id  — single heat with participants
router.get('/:id', authenticate, judgesOnly, async (req, res) => {
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
        WHERE h.id = $1
        GROUP BY h.id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/heats/:id/results
router.get('/:id/results', authenticate, judgesOnly, async (req, res) => {
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

// GET /api/heats/:id/leaderboard — spectator-facing, available to any role.
router.get('/:id/leaderboard', authenticate, async (req, res) => {
  try {
    const board = await computeHeatLeaderboard(req.params.id);
    if (!board) return res.status(404).json({ error: 'Heat not found' });
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/laps', authenticate, judgesOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, p.first_name, p.last_name, p.team
         FROM laps l
         JOIN pilots p ON p.id = l.pilot_id
        WHERE l.heat_id = $1
        ORDER BY l.pilot_id, l.lap_number`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/heats  (chief_judge | admin)
//
// Body может содержать `participants: [{ pilot_id, lane }]` — записываем в
// `heat_participants` атомарно с самим heat.
router.post('/', authenticate, authorize('chief_judge', 'admin'), async (req, res) => {
  const {
    competition_id,
    round_type,
    heat_number,
    judge_id,
    scheduled_at,
    group_id,
    lap_limit,
    time_limit_seconds,
    participants,
  } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO heats
         (competition_id, round_type, heat_number, judge_id, scheduled_at,
          group_id, lap_limit, time_limit_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        competition_id,
        round_type,
        heat_number,
        judge_id || null,
        scheduled_at || null,
        group_id || null,
        lap_limit || null,
        time_limit_seconds || null,
      ]
    );
    const heat = rows[0];

    if (Array.isArray(participants) && participants.length) {
      for (const p of participants) {
        if (!p || !p.pilot_id) continue;
        await client.query(
          `INSERT INTO heat_participants (heat_id, pilot_id, lane)
           VALUES ($1, $2, $3)`,
          [heat.id, p.pilot_id, p.lane || null]
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json(heat);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Heat already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/:id/start', authenticate, authorize('judge', 'chief_judge', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE heats
          SET status = 'active',
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND status != 'locked'
        RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Heat not found or locked' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/laps', authenticate, authorize('judge', 'chief_judge', 'admin'), async (req, res) => {
  const { pilot_id, lap_number, duration_ms, valid, notes } = req.body;
  if (!pilot_id || !lap_number || !duration_ms) {
    return res.status(400).json({ error: 'pilot_id, lap_number, duration_ms required' });
  }
  try {
    const { rows: heatRows } = await pool.query(
      'SELECT id, status FROM heats WHERE id = $1',
      [req.params.id]
    );
    if (!heatRows.length) return res.status(404).json({ error: 'Heat not found' });
    if (heatRows[0].status === 'locked') return res.status(409).json({ error: 'Heat is locked' });

    const { rows } = await pool.query(
      `INSERT INTO laps
         (heat_id, pilot_id, lap_number, duration_ms, valid, recorded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (heat_id, pilot_id, lap_number)
       DO UPDATE SET
         duration_ms = EXCLUDED.duration_ms,
         valid = EXCLUDED.valid,
         recorded_by = EXCLUDED.recorded_by,
         notes = EXCLUDED.notes,
         completed_at = NOW()
       RETURNING *`,
      [
        req.params.id,
        pilot_id,
        lap_number,
        duration_ms,
        valid !== false,
        req.user.id,
        notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/lap-summary', authenticate, judgesOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pilot_id, lap_number, duration_ms, valid
         FROM laps
        WHERE heat_id = $1
        ORDER BY pilot_id, lap_number`,
      [req.params.id]
    );
    const byPilot = rows.reduce((acc, lap) => {
      if (!acc[lap.pilot_id]) acc[lap.pilot_id] = [];
      acc[lap.pilot_id].push(lap);
      return acc;
    }, {});
    res.json(Object.entries(byPilot).map(([pilotId, laps]) => ({
      pilot_id: Number(pilotId),
      ...summarizeLaps(laps),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/falsestarts', authenticate, authorize('judge', 'chief_judge', 'admin'), async (req, res) => {
  const { pilot_id, reason } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO falsestarts (heat_id, pilot_id, reason, recorded_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, pilot_id || null, reason || null, req.user.id]
    );
    res.status(201).json({
      ...rows[0],
      reflight_recommended: shouldRequestWholeGroupReflight('falsestart'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/heats/:id/channel-conflicts — pre-flight check (§5.5.7.1.4-9).
// Возвращает список каналов 5.8 ГГц, на которые претендуют ≥2 активных дрона
// участников вылета. Используется судьёй в зоне пилотов перед стартом.
router.get('/:id/channel-conflicts',
  authenticate, judgesOnly,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT hp.pilot_id,
                d.id AS drone_id,
                d.video_channel_id,
                vc.code AS video_channel_code
           FROM heat_participants hp
           LEFT JOIN drones d ON d.pilot_id = hp.pilot_id AND d.is_active = true
           LEFT JOIN video_channels vc ON vc.id = d.video_channel_id
          WHERE hp.heat_id = $1`,
        [req.params.id]
      );
      const conflicts = detectChannelConflicts(rows);
      res.json({ heat_id: Number(req.params.id), assignments: rows, conflicts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/heats/:id/reflight-impact — classify a proposed reflight reason.
// Body: { reason, guilty_pilot_id? }
// Doesn't write to DB; useful for UI to display impact before persisting.
router.post('/:id/reflight-impact',
  authenticate, judgesOnly,
  (req, res) => {
    const { reason, guilty_pilot_id } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason required' });
    res.json({
      heat_id: Number(req.params.id),
      ...classifyReflightImpact(reason, { guilty_pilot_id: guilty_pilot_id || null }),
    });
  }
);

router.post('/:id/reflights', authenticate, authorize('chief_judge', 'admin'), async (req, res) => {
  const { reason, notes, status } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason required' });
  try {
    const { rows: heatRows } = await pool.query(
      'SELECT id, group_id FROM heats WHERE id = $1',
      [req.params.id]
    );
    if (!heatRows.length) return res.status(404).json({ error: 'Heat not found' });

    const { rows } = await pool.query(
      `INSERT INTO reflights (heat_id, group_id, reason, requested_by, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.params.id,
        heatRows[0].group_id || null,
        reason,
        req.user.id,
        status || 'requested',
        notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/end', authenticate, authorize('judge', 'chief_judge', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE heats
          SET status = 'completed',
              ended_at = COALESCE(ended_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND status != 'locked'
        RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Heat not found or locked' });
    res.json(rows[0]);
  } catch (err) {
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
