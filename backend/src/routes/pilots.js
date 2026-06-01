const router = require('express').Router();
const multer = require('multer');
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const {
  importPilotEntries,
  parsePilotXlsx,
} = require('../services/pilotImport');

const XLSX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
]);

const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const okExt = /\.xlsx$/i.test(file.originalname || '');
    if (!okExt || !XLSX_MIME.has(file.mimetype)) {
      return cb(Object.assign(new Error('xlsx_file_required'), { status: 415 }));
    }
    cb(null, true);
  },
});

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
  try {
    const results = await importPilotEntries(req.body && req.body.entries);
    res.status(207).json(results);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// POST /api/pilots/import/xlsx — XLSX import with the same validation as JSON.
// Expects multipart/form-data field "file"; reads the first worksheet.
router.post('/import/xlsx', authenticate, authorize('admin'), (req, res) => {
  uploadXlsx.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(uploadErr.status || (uploadErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400)).json({
        error: uploadErr.message || 'xlsx_upload_failed',
      });
    }
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    try {
      const { entries, rowNumbers } = await parsePilotXlsx(req.file.buffer);
      const results = await importPilotEntries(entries);
      results.source = {
        filename: req.file.originalname,
        rows: entries.length,
      };
      for (const collection of [results.created, results.updated, results.errors]) {
        for (const item of collection) item.row = rowNumbers[item.index] || null;
      }
      res.status(207).json(results);
    } catch (err) {
      console.error('[import/xlsx]', err.message);
      res.status(err.status || 400).json({ error: err.message || 'xlsx_parse_failed' });
    }
  });
});

module.exports = router;
