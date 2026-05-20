'use strict';

/**
 * Синхронизация пилотов из FormDesigner → БД FeoSport2
 *
 * Алгоритм:
 *  1. POST /login.html → получаем сессионные куки
 *  2. GET /  → из window.__initStates.config.hash берём JWT
 *  3. GET api.formdesigner.ru/forms/:formId/entries → список заявок
 *  4. Upsert в таблицу pilots по external_id (дубли пропускаются)
 *
 * Запуск:
 *   node scripts/sync-formdesigner.js
 *   # или через npm:
 *   # "sync-fd": "node scripts/sync-formdesigner.js"
 */

// Ищем .env: сначала рядом со скриптом (dev), потом в /app (Docker)
const dotenv = require('dotenv');
const envPaths = [
  require('path').resolve(__dirname, '../../.env'),
  require('path').resolve(__dirname, '../../../.env'),
  '/app/.env',
];
for (const p of envPaths) {
  const r = dotenv.config({ path: p });
  if (!r.error) break;
}

const https  = require('https');
const http   = require('http');
const qs     = require('querystring');
const pool   = require('../src/config/db');

// ── Настройки ──────────────────────────────────────────────────────────────
const FD_EMAIL    = process.env.FD_EMAIL    || '';
const FD_PASSWORD = process.env.FD_PASSWORD || '';
const FD_FORM_ID  = process.env.FD_FORM_ID  || '245167';

// Маппинг fieldId → смысл (из формы 245167)
const FIELD = {
  FIO:        '3062474',  // Фамилия Имя Отчество
  EMAIL:      '3062475',  // Электронная почта
  PHONE:      '3062476',  // Номер телефона
  BIRTH_DATE: '3062477',  // Дата рождения
  RANK:       '3062478',  // Наличие разряда
  TEAM:       '3062479',  // Наименование команды
  SIM:        '3062480',  // Технический симулятор
  CLASS_TEAM: '3062481',  // 75й класс командный
  CLASS_IND:  '3062482',  // 75й класс личный
  NOTES:      '3062483',  // Доп. информация
  RADIO:      '3062485',  // Система управления
  VTX:        '3062486',  // VTX тип
  VTX_CH:     '3062487',  // VTX канал
};

// ── HTTP helper ─────────────────────────────────────────────────────────────
function request(options, body) {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'http:' ? http : https;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Собираем куки из Set-Cookie заголовков
function parseCookies(headers) {
  const setCookie = headers['set-cookie'] || [];
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

// ── Шаг 1+2: логин и получение JWT ─────────────────────────────────────────
async function getJwt() {
  // 1a. GET страница логина — берём CSRF токен + начальные куки
  const loginPage = await request({
    hostname: 'ac.formdesigner.ru',
    path: '/login.html',
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  const csrfMatch = loginPage.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) throw new Error('CSRF token not found on login page');
  const csrf = csrfMatch[1];
  const cookies1 = parseCookies(loginPage.headers);

  // 1b. POST логин
  const postBody = qs.stringify({
    _csrf: csrf,
    'LoginForm[email]':    FD_EMAIL,
    'LoginForm[password]': FD_PASSWORD,
  });

  const loginResp = await request({
    hostname: 'ac.formdesigner.ru',
    path: '/login.html',
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postBody),
      'Referer': 'https://ac.formdesigner.ru/login.html',
      'User-Agent': 'Mozilla/5.0',
      'Cookie': cookies1,
    },
  }, postBody);

  if (loginResp.status !== 302) {
    throw new Error(`Login failed, HTTP ${loginResp.status}`);
  }

  const cookies2 = parseCookies(loginResp.headers);
  const allCookies = [cookies1, cookies2].filter(Boolean).join('; ');

  // 2. GET главная страница → __initStates.config.hash
  const mainPage = await request({
    hostname: 'ac.formdesigner.ru',
    path: '/',
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cookie': allCookies,
    },
  });

  const stateMatch = mainPage.body.match(/var __initStates\s*=\s*(\{.+?\})\s*;/s);
  if (!stateMatch) throw new Error('__initStates not found in page');

  const state = JSON.parse(stateMatch[1]);
  const jwt = state?.config?.hash;
  if (!jwt) throw new Error('JWT hash not found in __initStates');

  console.log('✓ JWT получен (user:', state?.profile?.email, ')');
  return jwt;
}

// ── Шаг 3: получение заявок ─────────────────────────────────────────────────
async function fetchEntries(jwt, page = 1) {
  const resp = await request({
    hostname: 'api.formdesigner.ru',
    path: `/forms/${FD_FORM_ID}/entries?page=${page}&per-page=100`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Origin': 'https://ac.formdesigner.ru',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  const data = JSON.parse(resp.body);
  if (data.error) throw new Error(`API error: ${JSON.stringify(data.messages)}`);
  return data.data.entries;
}

// ── Парсинг ФИО ─────────────────────────────────────────────────────────────
function parseFio(fio) {
  if (!fio) return { last_name: '', first_name: '', middle_name: null };
  const parts = fio.trim().split(/\s+/);
  return {
    last_name:   parts[0] || '',
    first_name:  parts[1] || parts[0] || '',  // одно слово → дублируем в first_name
    middle_name: parts[2] || null,
  };
}

// ── Шаг 4: upsert в БД ──────────────────────────────────────────────────────
async function upsertPilots(entries) {
  let created = 0, skipped = 0, errors = 0;

  for (const entry of entries) {
    const f = entry.items || {};
    const fio = parseFio(f[FIELD.FIO]);

    if (!fio.last_name || !fio.first_name) {
      console.warn(`  ⚠ entry ${entry.id}: пустое ФИО, пропуск`);
      skipped++;
      continue;
    }

    const extId = String(entry.id);
    const birthDate = f[FIELD.BIRTH_DATE] || null;
    const team      = f[FIELD.TEAM]       || null;

    // Доп. поля сохраняем в video_channel (временно) как JSON строку
    const extra = JSON.stringify({
      email: f[FIELD.EMAIL]  || null,
      phone: f[FIELD.PHONE]  || null,
      rank:  f[FIELD.RANK]   || null,
      radio: f[FIELD.RADIO]  || null,
      vtx:   f[FIELD.VTX]    || null,
      vtx_ch: f[FIELD.VTX_CH] || null,
      sim:   f[FIELD.SIM]    || null,
      notes: f[FIELD.NOTES]  || null,
    });

    try {
      const { rowCount } = await pool.query(
        `INSERT INTO pilots
           (first_name, last_name, middle_name, birth_date, team, video_channel, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (external_id) DO NOTHING`,
        [fio.first_name, fio.last_name, fio.middle_name,
         birthDate, team, extra, extId]
      );

      if (rowCount > 0) {
        console.log(`  + Добавлен: ${fio.last_name} ${fio.first_name} (${team || '—'})`);
        created++;
      } else {
        console.log(`  = Уже есть: ${fio.last_name} ${fio.first_name} [${extId}]`);
        skipped++;
      }
    } catch (err) {
      console.error(`  ✗ Ошибка entry ${entry.id}:`, err.message);
      errors++;
    }
  }

  return { created, skipped, errors };
}

// ── Пагинация ────────────────────────────────────────────────────────────────
async function fetchAllEntries(jwt) {
  const first = await fetchEntries(jwt, 1);
  const { totalCount, pageCount, perPage } = first._meta;
  console.log(`✓ Заявок в форме: ${totalCount} (страниц: ${pageCount})`);

  let all = [...first.items];
  for (let p = 2; p <= pageCount; p++) {
    const page = await fetchEntries(jwt, p);
    all = all.concat(page.items);
  }
  return all;
}

// ── Добавляем уникальный индекс если нет ────────────────────────────────────
async function ensureUniqueIndex() {
  // Partial index не работает с ON CONFLICT — нужен полный.
  // NULL значения в PostgreSQL unique index не конфликтуют между собой.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pilots_external_id_uq
    ON pilots (external_id)
  `).catch(() => {});
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== FormDesigner → FeoSport2 sync ===');
  console.log(`Форма: ${FD_FORM_ID}`);

  if (!FD_EMAIL || !FD_PASSWORD) {
    console.error('Укажи FD_EMAIL и FD_PASSWORD в .env');
    process.exit(1);
  }

  try {
    await ensureUniqueIndex();

    const jwt     = await getJwt();
    const entries = await fetchAllEntries(jwt);
    const result  = await upsertPilots(entries);

    console.log('\n─────────────────────────────────');
    console.log(`✓ Добавлено:  ${result.created}`);
    console.log(`= Пропущено:  ${result.skipped}`);
    if (result.errors) console.log(`✗ Ошибок:     ${result.errors}`);
    console.log('─────────────────────────────────\n');
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
