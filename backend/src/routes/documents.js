'use strict';

// Documents API — загрузка/выгрузка приложений к заявкам.
//
//   POST   /api/documents       — multipart: file + metadata
//   GET    /api/documents       — фильтры pilot_id, team_id, application_id, doc_type
//   GET    /api/documents/:id   — метаданные
//   GET    /api/documents/:id/download — стрим файла
//   DELETE /api/documents/:id   — admin only
//
// Хранение — локально, путь резолвится через uploadConfig.
// Файлы лежат в подпапке по году/месяцу и шифруются at-rest AES-256-GCM.

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const multer = require('multer');

const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const {
  resolveDocumentsRoot, ensureDir, MAX_UPLOAD_BYTES, ALLOWED_MIME,
} = require('../services/uploadConfig');
const {
  encryptFileInPlace,
  decryptFile,
} = require('../services/documentEncryption');

const VALID_DOC_TYPES = [
  'passport', 'birth_certificate',
  'medical_clearance', 'medical_insurance', 'accident_insurance',
  'parental_consent', 'classification_book', 'other',
];

function makeStorage() {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        const root  = resolveDocumentsRoot();
        const now   = new Date();
        const yyyy  = String(now.getUTCFullYear());
        const mm    = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dir   = path.join(root, yyyy, mm);
        ensureDir(dir);
        cb(null, dir);
      } catch (err) { cb(err); }
    },
    filename(_req, file, cb) {
      // Random + timestamp avoids collisions; original name preserved in DB.
      const rand = crypto.randomBytes(8).toString('hex');
      const safeExt = path.extname(file.originalname).slice(0, 16).replace(/[^.\w]/g, '');
      cb(null, `${Date.now()}_${rand}${safeExt}`);
    },
  });
}

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(Object.assign(new Error(`mime_not_allowed:${file.mimetype}`), { status: 415 }));
  }
  cb(null, true);
}

const upload = multer({
  storage: makeStorage(),
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function sha256OfFile(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s    = fs.createReadStream(absPath);
    s.on('error', reject);
    s.on('data', (chunk) => hash.update(chunk));
    s.on('end',  () => resolve(hash.digest('hex')));
  });
}

// ─── Upload ──────────────────────────────────────────────────────────────────
router.post('/', authenticate, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const status = uploadErr.status || (uploadErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
      return (console.error(uploadErr), res.status(status).json({ error: 'Internal Server Error' }));
    }
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const { doc_type, pilot_id, team_id, application_id, valid_until } = req.body;
    if (!VALID_DOC_TYPES.includes(doc_type)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: `doc_type must be one of: ${VALID_DOC_TYPES.join(', ')}` });
    }
    if (!pilot_id && !team_id && !application_id) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'at least one of pilot_id / team_id / application_id is required' });
    }

    let hash;
    let encryption;
    try {
      hash = await sha256OfFile(req.file.path);
      encryption = await encryptFileInPlace(req.file.path);
    } catch (err) {
      fs.unlink(req.file.path, () => {});
      return (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
    }

    const root        = resolveDocumentsRoot();
    const relativePath = path.relative(root, req.file.path);

    try {
      const { rows } = await pool.query(
        `INSERT INTO documents
           (pilot_id, team_id, application_id, doc_type,
            file_name, file_path, file_size_bytes, file_hash_sha256,
            mime_type, valid_until, uploaded_by,
            encryption_algorithm, encryption_key_id, encryption_iv, encryption_auth_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          pilot_id || null,
          team_id  || null,
          application_id || null,
          doc_type,
          req.file.originalname,
          relativePath,
          req.file.size,
          hash,
          req.file.mimetype,
          valid_until || null,
          req.user.id,
          encryption.encryption_algorithm,
          encryption.encryption_key_id,
          encryption.encryption_iv,
          encryption.encryption_auth_tag,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      fs.unlink(req.file.path, () => {});
      (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
    }
  });
});

// ─── List ────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const where  = [];
  const values = [];
  for (const f of ['pilot_id', 'team_id', 'application_id', 'doc_type']) {
    if (req.query[f]) { values.push(req.query[f]); where.push(`${f} = $${values.length}`); }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT id, pilot_id, team_id, application_id, doc_type,
              file_name, file_size_bytes, mime_type, valid_until,
              uploaded_by, uploaded_at
         FROM documents
         ${whereSql}
        ORDER BY uploaded_at DESC`,
      values
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const doc = rows[0];

    const root    = resolveDocumentsRoot();
    const absPath = path.join(root, doc.file_path);
    // Path-traversal guard: resolved path must remain inside the documents root.
    if (!path.resolve(absPath).startsWith(path.resolve(root) + path.sep) &&
        path.resolve(absPath) !== path.resolve(root)) {
      return res.status(400).json({ error: 'invalid path' });
    }
    if (!fs.existsSync(absPath)) {
      return res.status(410).json({ error: 'file_gone' });
    }
    const plaintext = await decryptFile(absPath, doc);
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`);
    res.setHeader('Content-Length', plaintext.length);
    res.send(plaintext);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const root    = resolveDocumentsRoot();
    const absPath = path.join(root, rows[0].file_path);
    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    fs.unlink(absPath, () => {}); // best-effort, ignore missing
    res.json({ deleted: 1 });
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

module.exports = router;
