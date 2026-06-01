const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const {
  pilotRegistrationEntrySchema,
  parseFio,
} = require('../schemas/pilotRegistration');

// GET /api/pilots
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pilots ORDER BY last_name, first_name'
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// GET /api/pilots/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pilots WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
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
    if (err.code === '23505') return res.status(409).json({ error: err.detail || 'Duplicate' });
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
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
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
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
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
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
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

// POST /api/pilots/import — bulk-импорт пилотов (admin only)
//
// Payload: { entries: [<pilotRegistrationEntrySchema>, ...] }
//   Каждая запись проходит Zod-валидацию (см. schemas/pilotRegistration.js).
//   Допустимые значения dropdown'ов — см. constants/pilotRegistration.js;
//   они синхронизированы с FormDesigner-формой 245167.
//
// Возвращает 207 Multi-Status с по-строчным результатом:
//   { created: [...], updated: [...], errors: [{index, entry, reason}] }
//
// Дедупликация: ON CONFLICT (external_id). Если external_id не задан —
// PostgreSQL допускает дубли (NULL ≠ NULL в unique индексе).
router.post('/import', authenticate, authorize('admin'), async (req, res) => {
  const entries = req.body && req.body.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({
      error: 'entries[] array required (1..500 records)',
    });
  }
  if (entries.length > 500) {
    return res.status(400).json({
      error: 'Too many entries — split into batches of 500',
    });
  }

  const results = { created: [], updated: [], errors: [] };

  for (let i = 0; i < entries.length; i++) {
    // Per-entry Zod validation: invalid rows go into errors[], valid ones
    // proceed to DB. This is gentler than rejecting the whole batch.
    const parseResult = pilotRegistrationEntrySchema.safeParse(entries[i]);
    if (!parseResult.success) {
      results.errors.push({
        index: i,
        entry: entries[i],
        reason: parseResult.error.issues
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; '),
      });
      continue;
    }

    const entry = parseResult.data;
    const fio   = parseFio(entry.fio);

    if (!fio.last_name || !fio.first_name) {
      results.errors.push({
        index: i,
        entry,
        reason: 'FIO must contain at least last name and first name',
      });
      continue;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO pilots (
            first_name, last_name, middle_name, birth_date, team,
            email, phone, has_rank, sport_rank,
            radio_system, vtx_type, vtx_channel, drone_simulator,
            external_id
         ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, $13,
            $14
         )
         ON CONFLICT (external_id) DO UPDATE SET
            first_name      = EXCLUDED.first_name,
            last_name       = EXCLUDED.last_name,
            middle_name     = EXCLUDED.middle_name,
            birth_date      = COALESCE(EXCLUDED.birth_date, pilots.birth_date),
            team            = COALESCE(EXCLUDED.team, pilots.team),
            email           = COALESCE(EXCLUDED.email, pilots.email),
            phone           = COALESCE(EXCLUDED.phone, pilots.phone),
            has_rank        = COALESCE(EXCLUDED.has_rank, pilots.has_rank),
            sport_rank      = COALESCE(EXCLUDED.sport_rank, pilots.sport_rank),
            radio_system    = COALESCE(EXCLUDED.radio_system, pilots.radio_system),
            vtx_type        = COALESCE(EXCLUDED.vtx_type, pilots.vtx_type),
            vtx_channel     = COALESCE(EXCLUDED.vtx_channel, pilots.vtx_channel),
            drone_simulator = COALESCE(EXCLUDED.drone_simulator, pilots.drone_simulator)
         RETURNING id, (xmax = 0) AS inserted`,
        [
          fio.first_name, fio.last_name, fio.middle_name,
          entry.birth_date || null,
          entry.team || null,
          entry.email || null,
          entry.phone || null,
          entry.has_rank === undefined || entry.has_rank === null ? null : entry.has_rank,
          // sport_rank — текстовое значение разряда; в FD-форме только Yes/No,
          // поэтому проставляем 'Да' если has_rank=true, иначе NULL.
          entry.has_rank === true ? 'Да' : null,
          entry.radio_system || null,
          entry.vtx_type || null,
          entry.vtx_channel || null,
          entry.drone_simulator || null,
          entry.external_id || null,
        ]
      );

      const row = rows[0];
      if (row.inserted) {
        results.created.push({ index: i, pilot_id: row.id });
      } else {
        results.updated.push({ index: i, pilot_id: row.id });
      }
    } catch (err) {
      console.error(`[import] entry ${i} (${entry.fio}):`, err.message);
      results.errors.push({
        index: i,
        entry,
        reason: err.code === '23505' ? 'Duplicate (unique constraint)' : err.message,
      });
    }
  }

  res.status(207).json(results);
});

module.exports = router;
