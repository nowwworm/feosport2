'use strict';

// Applications API — заявки участников по образцам Приложений 2-3.
//
// Workflow:
//   draft     — создана, можно редактировать
//   submitted — отправлена в Комиссию по допуску
//   approved  — комиссия допустила (decision = 'admitted')
//   rejected  — комиссия отклонила (decision = 'rejected')

const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { checkEligibility } = require('../services/ageGroup');

const VALID_STAGES = ['preliminary', 'final'];

// GET /api/applications?competition_id=…&status=…&stage=…
router.get('/', authenticate, async (req, res) => {
  const { competition_id, status, stage } = req.query;
  const where  = [];
  const values = [];
  if (competition_id) { values.push(competition_id); where.push(`a.competition_id = $${values.length}`); }
  if (status)         { values.push(status);         where.push(`a.status = $${values.length}`); }
  if (stage)          { values.push(stage);          where.push(`a.stage = $${values.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT a.*,
              c.name AS competition_name,
              p.first_name AS pilot_first_name, p.last_name AS pilot_last_name,
              t.name AS team_name
         FROM applications a
         JOIN competitions c ON c.id = a.competition_id
         LEFT JOIN pilots p   ON p.id = a.pilot_id
         LEFT JOIN teams  t   ON t.id = a.team_id
         ${whereSql}
        ORDER BY a.created_at DESC`,
      values
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,
              c.name AS competition_name,
              p.first_name AS pilot_first_name, p.last_name AS pilot_last_name,
              t.name AS team_name
         FROM applications a
         JOIN competitions c ON c.id = a.competition_id
         LEFT JOIN pilots p   ON p.id = a.pilot_id
         LEFT JOIN teams  t   ON t.id = a.team_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: documents } = await pool.query(
      `SELECT id, doc_type, file_name, file_path, valid_until, uploaded_at
         FROM documents
        WHERE application_id = $1 OR
              (pilot_id IS NOT NULL AND pilot_id = $2) OR
              (team_id  IS NOT NULL AND team_id  = $3)`,
      [req.params.id, rows[0].pilot_id, rows[0].team_id]
    );
    res.json({ ...rows[0], documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications  — создать draft заявку
router.post('/', authenticate, async (req, res) => {
  const {
    competition_id, pilot_id, team_id, stage,
    contact_email, contact_phone, notes
  } = req.body;

  if (!competition_id) return res.status(400).json({ error: 'competition_id required' });
  if (!stage || !VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(', ')}` });
  }
  const hasPilot = !!pilot_id;
  const hasTeam  = !!team_id;
  if (hasPilot === hasTeam) {
    return res.status(400).json({ error: 'exactly one of pilot_id / team_id must be provided' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO applications
         (competition_id, pilot_id, team_id, stage, status, contact_email, contact_phone, notes)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)
       RETURNING *`,
      [competition_id, pilot_id || null, team_id || null, stage,
       contact_email || null, contact_phone || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Duplicate application for this competition/subject/stage' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications/:id/submit  — отправить заявку в комиссию
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    // Загружаем заявку + соревнование + age_group + пилота для валидации.
    const { rows } = await pool.query(
      `SELECT a.*,
              c.start_date AS comp_start_date,
              c.gender     AS comp_gender,
              ag.code      AS age_group_code,
              ag.min_age   AS age_min,
              ag.max_age   AS age_max,
              ag.age_check AS age_check,
              p.birth_date AS pilot_birth_date,
              p.gender     AS pilot_gender,
              p.medical_clearance_until,
              p.insurance_until
         FROM applications a
         JOIN competitions c ON c.id = a.competition_id
         LEFT JOIN age_groups ag ON ag.id = c.age_group_id
         LEFT JOIN pilots p ON p.id = a.pilot_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const app = rows[0];

    if (app.status !== 'draft') {
      return res.status(409).json({ error: `cannot submit from status: ${app.status}` });
    }

    // Финальные заявки на личные соревнования — валидируем возраст и срок документов.
    if (app.stage === 'final' && app.pilot_id) {
      if (!app.pilot_birth_date) {
        return res.status(400).json({ error: 'pilot has no birth_date' });
      }
      if (app.age_group_code) {
        const verdict = checkEligibility(app.pilot_birth_date, app.comp_start_date, {
          code:       app.age_group_code,
          min_age:    app.age_min,
          max_age:    app.age_max,
          age_check:  app.age_check,
        });
        if (!verdict.ok) {
          return res.status(400).json({ error: `age_group_mismatch: ${verdict.reason}` });
        }
      }
      if (app.comp_gender && app.comp_gender !== 'X' && app.pilot_gender &&
          app.comp_gender !== app.pilot_gender) {
        return res.status(400).json({ error: 'gender_mismatch' });
      }
      // Действующий мед.допуск и страховка на дату начала.
      const startDate = new Date(app.comp_start_date);
      if (!app.medical_clearance_until || new Date(app.medical_clearance_until) < startDate) {
        return res.status(400).json({ error: 'medical_clearance_expired_or_missing' });
      }
      if (!app.insurance_until || new Date(app.insurance_until) < startDate) {
        return res.status(400).json({ error: 'insurance_expired_or_missing' });
      }
    }

    const { rows: updated } = await pool.query(
      `UPDATE applications SET status = 'submitted' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications/:id/decide  — Комиссия по допуску выносит решение
router.post('/:id/decide', authenticate, authorize('admin', 'chief_judge'),
  async (req, res) => {
    const { decision, reason } = req.body;
    if (!['admitted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'admitted' or 'rejected'" });
    }
    const newStatus = decision === 'admitted' ? 'approved' : 'rejected';
    try {
      const { rows } = await pool.query(
        `UPDATE applications
            SET decision = $1,
                decision_reason = $2,
                decided_by = $3,
                decided_at = NOW(),
                status = $4
          WHERE id = $5
          RETURNING *`,
        [decision, reason || null, req.user.id, newStatus, req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/applications/:id/admission-status
//
// Агрегирует статус допуска: решение комиссии + результаты техосмотра дронов.
// Минимум дронов по правилам §5.5.7.1.1 (личные) / §5.5.8.1.4 (командные).
router.get('/:id/admission-status', authenticate, async (req, res) => {
  try {
    const { rows: appRows } = await pool.query(
      `SELECT a.*, d.is_team AS discipline_is_team
         FROM applications a
         JOIN competitions c ON c.id = a.competition_id
         LEFT JOIN disciplines d ON d.id = c.discipline_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!appRows.length) return res.status(404).json({ error: 'Not found' });
    const app = appRows[0];

    // Минимум дронов: 3 для командных, 2 для личных (по умолчанию).
    const dronesRequired = app.discipline_is_team ? 3 : 2;

    let dronesQuery;
    let dronesParams;
    if (app.pilot_id) {
      dronesQuery  = `SELECT d.id, d.drone_class,
                             (SELECT result FROM equipment_inspections i
                               WHERE i.drone_id = d.id
                               ORDER BY i.inspected_at DESC LIMIT 1) AS latest_result
                        FROM drones d
                       WHERE d.pilot_id = $1 AND d.is_active = true`;
      dronesParams = [app.pilot_id];
    } else {
      dronesQuery  = `SELECT d.id, d.drone_class,
                             (SELECT result FROM equipment_inspections i
                               WHERE i.drone_id = d.id
                               ORDER BY i.inspected_at DESC LIMIT 1) AS latest_result
                        FROM drones d
                       WHERE d.team_id = $1 AND d.is_active = true`;
      dronesParams = [app.team_id];
    }
    const { rows: drones } = await pool.query(dronesQuery, dronesParams);

    const passed = drones.filter(d => d.latest_result === 'passed').length;
    const rejected = drones.filter(d => d.latest_result === 'rejected').length;
    const conditional = drones.filter(d => d.latest_result === 'conditional').length;
    const unchecked = drones.filter(d => d.latest_result === null).length;

    const blockers = [];
    if (app.status !== 'approved') blockers.push(`application_not_approved:${app.status}`);
    if (drones.length < dronesRequired) blockers.push(
      `not_enough_drones:${drones.length}/${dronesRequired}`
    );
    if (passed < dronesRequired) blockers.push(
      `not_enough_passed_drones:${passed}/${dronesRequired}`
    );

    res.json({
      application_id: app.id,
      application_status: app.status,
      decision: app.decision,
      drones_required: dronesRequired,
      drones_registered: drones.length,
      drones_passed: passed,
      drones_rejected: rejected,
      drones_conditional: conditional,
      drones_unchecked: unchecked,
      fully_admitted: blockers.length === 0,
      blockers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/applications/:id — редактировать draft
router.patch('/:id', authenticate, async (req, res) => {
  const fields = ['contact_email', 'contact_phone', 'notes',
                  'entry_fee_paid_at', 'entry_fee_amount_rub',
                  'signed_by_representative_at', 'signed_by_region_fed_at',
                  'signed_by_authority_at', 'signed_by_doctor_at'];
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
      `UPDATE applications
          SET ${updates.join(', ')}
        WHERE id = $${values.length} AND status IN ('draft', 'submitted')
        RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found or already decided' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM applications WHERE id = $1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
