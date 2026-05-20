const router = require('express').Router();
const pool   = require('../config/db');

// Опциональная проверка секретного токена
// Задай WEBHOOK_SECRET в .env — formdesigner передаёт его как ?secret=...
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

function checkSecret(req, res, next) {
  if (!WEBHOOK_SECRET) return next();
  const token = req.query.secret || req.headers['x-webhook-secret'];
  if (token !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  next();
}

// Маппинг полей formdesigner → поля таблицы pilots
// Ключи — возможные имена полей в форме (case-insensitive поиск)
const FIELD_MAP = {
  first_name:    ['first_name', 'имя', 'name', 'firstname'],
  last_name:     ['last_name', 'фамилия', 'surname', 'lastname'],
  middle_name:   ['middle_name', 'отчество', 'patronymic'],
  birth_date:    ['birth_date', 'дата_рождения', 'birthdate', 'birthday', 'дата рождения'],
  team:          ['team', 'команда', 'club', 'клуб'],
  city:          ['city', 'город', 'city_name'],
  video_channel: ['video_channel', 'видео', 'youtube', 'rutube', 'канал', 'channel'],
};

function extractField(body, aliases) {
  const bodyLower = {};
  Object.keys(body).forEach(k => { bodyLower[k.toLowerCase()] = body[k]; });
  for (const alias of aliases) {
    if (bodyLower[alias.toLowerCase()] !== undefined) {
      return bodyLower[alias.toLowerCase()];
    }
  }
  return null;
}

// POST /api/webhook/pilot-registration
// formdesigner шлёт POST с полями формы в теле запроса
router.post('/pilot-registration', checkSecret, async (req, res) => {
  const body = req.body || {};

  // Логируем входящие данные (убрать в проде если нет нужды)
  console.log('[webhook] pilot-registration received:', JSON.stringify(body));

  const first_name = extractField(body, FIELD_MAP.first_name);
  const last_name  = extractField(body, FIELD_MAP.last_name);

  if (!first_name || !last_name) {
    console.warn('[webhook] Missing required fields first_name/last_name');
    return res.status(400).json({ error: 'first_name and last_name are required' });
  }

  // external_id — уникальный ID заявки из formdesigner (предотвращает дубли)
  const externalId = body.id || body.form_id || body.submission_id
    || body['_id'] || null;

  try {
    // Проверяем дубль по external_id
    if (externalId) {
      const { rows } = await pool.query(
        'SELECT id FROM pilots WHERE external_id = $1',
        [String(externalId)]
      );
      if (rows.length) {
        console.log(`[webhook] Duplicate submission external_id=${externalId}, skipping`);
        return res.json({ status: 'duplicate', pilot_id: rows[0].id });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO pilots
         (first_name, last_name, middle_name, birth_date, team, city, video_channel, external_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, first_name, last_name, team`,
      [
        first_name,
        last_name,
        extractField(body, FIELD_MAP.middle_name),
        extractField(body, FIELD_MAP.birth_date) || null,
        extractField(body, FIELD_MAP.team),
        extractField(body, FIELD_MAP.city),
        extractField(body, FIELD_MAP.video_channel),
        externalId ? String(externalId) : null,
      ]
    );

    console.log(`[webhook] Pilot created: id=${rows[0].id} ${rows[0].last_name} ${rows[0].first_name}`);
    res.status(201).json({ status: 'created', pilot: rows[0] });

  } catch (err) {
    console.error('[webhook] DB error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/webhook/pilot-registration — для проверки что эндпоинт живой
router.get('/pilot-registration', (_req, res) => {
  res.json({ status: 'ok', endpoint: 'POST /api/webhook/pilot-registration' });
});

module.exports = router;
