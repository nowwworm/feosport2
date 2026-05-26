'use strict';

// Drones API — регистрация и технический контроль БВС.
//
//   GET    /api/drones?pilot_id=…|team_id=…|class=…
//   GET    /api/drones/:id                       — drone + latest inspection
//   POST   /api/drones                           — register new drone
//   PATCH  /api/drones/:id                       — update measurements
//   DELETE /api/drones/:id                       — admin only
//
//   GET    /api/drones/:id/inspections           — history
//   POST   /api/drones/:id/inspect               — tech-judge / chief_judge records inspection
//   GET    /api/drones/:id/validate              — dry-run check against drone_specs
//                                                  (no DB write, useful before submitting)

const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validateDrone } = require('../services/droneValidator');

const VALID_CLASSES = ['75mm', '200mm', '330mm'];
const VALID_RESULTS = ['passed', 'rejected', 'conditional'];

const WRITABLE_FIELDS = [
  'name', 'serial_number', 'weight_g', 'diagonal_mm',
  'motor_size', 'motor_kv', 'propeller_inches',
  'video_channel_id', 'video_power_mw', 'control_power_mw',
  'battery_cells', 'battery_capacity_mah', 'battery_max_cell_voltage',
  'leds_count', 'has_prop_guards', 'has_failsafe',
  'notes', 'is_active',
];

async function loadSpec(droneClass) {
  const { rows } = await pool.query(
    'SELECT * FROM drone_specs WHERE drone_class = $1',
    [droneClass]
  );
  return rows[0] || null;
}

// ─── List ────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const where  = [];
  const values = [];
  if (req.query.pilot_id) { values.push(req.query.pilot_id); where.push(`d.pilot_id = $${values.length}`); }
  if (req.query.team_id)  { values.push(req.query.team_id);  where.push(`d.team_id = $${values.length}`); }
  if (req.query.class)    { values.push(req.query.class);    where.push(`d.drone_class = $${values.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT d.*,
              vc.code AS video_channel_code,
              vc.frequency_mhz AS video_frequency_mhz,
              (SELECT json_build_object(
                  'id', i.id, 'result', i.result, 'inspected_at', i.inspected_at,
                  'violations', i.violations
              ) FROM equipment_inspections i
                WHERE i.drone_id = d.id
                ORDER BY i.inspected_at DESC LIMIT 1) AS latest_inspection
         FROM drones d
         LEFT JOIN video_channels vc ON vc.id = d.video_channel_id
         ${whereSql}
        ORDER BY d.created_at DESC`,
      values
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*,
              vc.code AS video_channel_code,
              vc.frequency_mhz AS video_frequency_mhz
         FROM drones d
         LEFT JOIN video_channels vc ON vc.id = d.video_channel_id
        WHERE d.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: inspections } = await pool.query(
      `SELECT id, result, violations, notes, inspected_by, inspected_at
         FROM equipment_inspections
        WHERE drone_id = $1
        ORDER BY inspected_at DESC`,
      [req.params.id]
    );
    res.json({ ...rows[0], inspections });
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// ─── Create ──────────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { pilot_id, team_id, drone_class } = req.body;
  if (!drone_class || !VALID_CLASSES.includes(drone_class)) {
    return res.status(400).json({ error: `drone_class must be one of: ${VALID_CLASSES.join(', ')}` });
  }
  const hasPilot = !!pilot_id;
  const hasTeam  = !!team_id;
  if (hasPilot === hasTeam) {
    return res.status(400).json({ error: 'exactly one of pilot_id / team_id must be provided' });
  }

  const cols = ['pilot_id', 'team_id', 'drone_class', ...WRITABLE_FIELDS.filter(f => req.body[f] !== undefined)];
  const vals = [pilot_id || null, team_id || null, drone_class];
  for (const f of WRITABLE_FIELDS) {
    if (req.body[f] !== undefined) vals.push(req.body[f]);
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');

  try {
    const { rows } = await pool.query(
      `INSERT INTO drones (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// ─── Update measurements ─────────────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  const updates = [];
  const values  = [];
  for (const f of WRITABLE_FIELDS) {
    if (req.body[f] !== undefined) {
      values.push(req.body[f]);
      updates.push(`${f} = $${values.length}`);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);

  try {
    const { rows } = await pool.query(
      `UPDATE drones SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM drones WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: 1 });
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// ─── Dry-run validation (no DB write) ────────────────────────────────────────
router.get('/:id/validate', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM drones WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const drone = rows[0];
    const spec  = await loadSpec(drone.drone_class);
    if (!spec) return res.status(500).json({ error: `No spec for class ${drone.drone_class}` });

    const violations = validateDrone(drone, spec);
    const errors   = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');
    res.json({
      drone_id: drone.id,
      drone_class: drone.drone_class,
      would_pass: errors.length === 0,
      errors,
      warnings,
    });
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// ─── Inspections ─────────────────────────────────────────────────────────────
router.get('/:id/inspections', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, u.email AS inspected_by_email
         FROM equipment_inspections i
         JOIN users u ON u.id = i.inspected_by
        WHERE i.drone_id = $1
        ORDER BY i.inspected_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// POST /api/drones/:id/inspect
// Body: { result?: 'passed'|'rejected'|'conditional', notes?, application_id?, force? }
//
// Если result не передан — считаем автоматически через validateDrone:
//   нет error-нарушений → 'passed', иначе → 'rejected'.
// Если result передан вручную судьёй — используем его, но всё равно
// записываем фактический список нарушений (как audit trail).
//
// `force=true` позволяет судье вручную поставить 'passed' даже при наличии
// нарушений (например, малозначимое предупреждение). По умолчанию — отказываем.
router.post('/:id/inspect',
  authenticate, authorize('admin', 'chief_judge'),
  async (req, res) => {
    const { result, notes, application_id, force } = req.body;
    if (result !== undefined && !VALID_RESULTS.includes(result)) {
      return res.status(400).json({ error: `result must be one of: ${VALID_RESULTS.join(', ')}` });
    }

    try {
      const { rows: dRows } = await pool.query('SELECT * FROM drones WHERE id = $1', [req.params.id]);
      if (!dRows.length) return res.status(404).json({ error: 'Drone not found' });
      const drone = dRows[0];

      const spec = await loadSpec(drone.drone_class);
      if (!spec) return res.status(500).json({ error: `No spec for class ${drone.drone_class}` });

      const violations = validateDrone(drone, spec);
      const errors     = violations.filter(v => v.severity === 'error');

      let finalResult = result;
      if (!finalResult) {
        finalResult = errors.length === 0 ? 'passed' : 'rejected';
      } else if (finalResult === 'passed' && errors.length > 0 && !force) {
        return res.status(400).json({
          error: 'cannot mark passed with active error violations; pass force=true to override',
          errors,
        });
      }

      const { rows } = await pool.query(
        `INSERT INTO equipment_inspections
           (drone_id, application_id, inspected_by, result, violations, notes)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING *`,
        [
          drone.id,
          application_id || null,
          req.user.id,
          finalResult,
          JSON.stringify(violations),
          notes || null,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
    }
  }
);

module.exports = router;
