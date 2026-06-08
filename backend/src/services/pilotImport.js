'use strict';

const ExcelJS = require('exceljs');
const pool = require('../config/db');
const {
  pilotRegistrationEntrySchema,
  parseFio,
} = require('../schemas/pilotRegistration');

const HEADER_ALIASES = new Map([
  ['fio', 'fio'],
  ['фио', 'fio'],
  ['фамилияимяотчество', 'fio'],
  ['фамилияимя', 'fio'],
  ['участник', 'fio'],
  ['пилот', 'fio'],

  ['email', 'email'],
  ['e-mail', 'email'],
  ['почта', 'email'],
  ['электроннаяпочта', 'email'],

  ['phone', 'phone'],
  ['телефон', 'phone'],
  ['номертелефона', 'phone'],
  ['мобильныйтелефон', 'phone'],

  ['birthdate', 'birth_date'],
  ['birth_date', 'birth_date'],
  ['датарождения', 'birth_date'],
  ['датараждения', 'birth_date'],

  ['hasrank', 'has_rank'],
  ['has_rank', 'has_rank'],
  ['разряд', 'has_rank'],
  ['наличиеразряда', 'has_rank'],

  ['team', 'team'],
  ['команда', 'team'],
  ['наименованиекоманды', 'team'],

  ['radio', 'radio_system'],
  ['radiosystem', 'radio_system'],
  ['radio_system', 'radio_system'],
  ['радио', 'radio_system'],
  ['системауправления', 'radio_system'],

  ['vtx', 'vtx_type'],
  ['vtxtype', 'vtx_type'],
  ['vtx_type', 'vtx_type'],
  ['типvtx', 'vtx_type'],
  ['vtxтип', 'vtx_type'],

  ['vtxchannel', 'vtx_channel'],
  ['vtx_channel', 'vtx_channel'],
  ['канал', 'vtx_channel'],
  ['vtxканал', 'vtx_channel'],

  ['simulator', 'drone_simulator'],
  ['drone_simulator', 'drone_simulator'],
  ['симулятор', 'drone_simulator'],
  ['техническийсимулятор', 'drone_simulator'],

  ['class75team', 'class_75_team'],
  ['class_75_team', 'class_75_team'],
  ['75класскомандный', 'class_75_team'],
  ['75йкласскомандный', 'class_75_team'],
  ['75-йкласскомандный', 'class_75_team'],
  ['75ыйкласскомандный', 'class_75_team'],
  ['командный75класс', 'class_75_team'],

  ['class75individual', 'class_75_individual'],
  ['class_75_individual', 'class_75_individual'],
  ['75классичный', 'class_75_individual'],
  ['75классиндивидуальный', 'class_75_individual'],
  ['75классиндивидуально', 'class_75_individual'],
  ['75классличный', 'class_75_individual'],
  ['75йклассличный', 'class_75_individual'],
  ['75-йклассличный', 'class_75_individual'],
  ['75ыйклассличный', 'class_75_individual'],
  ['личный75класс', 'class_75_individual'],

  ['notes', 'notes'],
  ['примечание', 'notes'],
  ['примечания', 'notes'],
  ['допинформация', 'notes'],
  ['дополнительнаяинформация', 'notes'],

  ['externalid', 'external_id'],
  ['external_id', 'external_id'],
  ['idcrm', 'external_id'],
  ['crm_id', 'external_id'],
  ['id_crm', 'external_id'],
  ['fdid', 'external_id'],
  ['formdesignerid', 'external_id'],
]);

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s"'`.,;:()[\]{}<>/\\|+-]/g, '');
}

function normalizeBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase().replace(/ё/g, 'е');
  if (['да', 'yes', 'true', '1', 'есть', 'имеется', 'с разрядом'].includes(s)) return true;
  if (['нет', 'no', 'false', '0', 'без', 'без разряда'].includes(s)) return false;
  return value;
}

function excelSerialToDate(value) {
  if (typeof value !== 'number' || value < 1 || value > 80000) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
}

function cellToValue(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return value;
  if (value.text) return value.text;
  if (value.result !== undefined) return value.result;
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  if (value.hyperlink && value.text) return value.text;
  return String(value);
}

function normalizeCell(field, value) {
  const raw = cellToValue(value);
  if (raw === '') return null;
  if (field === 'has_rank' || field === 'class_75_team' || field === 'class_75_individual') {
    return normalizeBoolean(raw);
  }
  if (field === 'birth_date') {
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    const serial = excelSerialToDate(raw);
    if (serial) return serial;
  }
  return String(raw).trim();
}

function rowIsEmpty(entry) {
  return Object.values(entry).every(value => value === null || value === '');
}

async function parsePilotXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('xlsx_first_sheet_required');

  const headerRow = sheet.getRow(1);
  const columns = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = HEADER_ALIASES.get(normalizeHeader(cellToValue(cell.value)));
    if (key) columns.push({ colNumber, key });
  });

  if (!columns.some(col => col.key === 'fio')) {
    throw new Error('xlsx_header_fio_required');
  }

  const entries = [];
  const rowNumbers = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry = {};
    for (const { colNumber, key } of columns) {
      entry[key] = normalizeCell(key, row.getCell(colNumber).value);
    }
    if (rowIsEmpty(entry)) return;
    entries.push(entry);
    rowNumbers.push(rowNumber);
  });

  return { entries, rowNumbers };
}

async function importPilotEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    const error = new Error('entries[] array required (1..500 records)');
    error.status = 400;
    throw error;
  }
  if (entries.length > 500) {
    const error = new Error('Too many entries — split into batches of 500');
    error.status = 400;
    throw error;
  }

  const results = { created: [], updated: [], errors: [] };

  for (let i = 0; i < entries.length; i++) {
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
    const fio = parseFio(entry.fio);

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
            email, phone, has_rank,
            radio_system, vtx_type, vtx_channel, drone_simulator,
            class_75_team, class_75_individual, registration_notes,
            external_id
         ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15,
            $16
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
            radio_system    = COALESCE(EXCLUDED.radio_system, pilots.radio_system),
            vtx_type        = COALESCE(EXCLUDED.vtx_type, pilots.vtx_type),
            vtx_channel     = COALESCE(EXCLUDED.vtx_channel, pilots.vtx_channel),
            drone_simulator = COALESCE(EXCLUDED.drone_simulator, pilots.drone_simulator),
            class_75_team = COALESCE(EXCLUDED.class_75_team, pilots.class_75_team),
            class_75_individual = COALESCE(EXCLUDED.class_75_individual, pilots.class_75_individual),
            registration_notes = COALESCE(EXCLUDED.registration_notes, pilots.registration_notes)
         RETURNING id, (xmax = 0) AS inserted`,
        [
          fio.first_name, fio.last_name, fio.middle_name,
          entry.birth_date || null,
          entry.team || null,
          entry.email || null,
          entry.phone || null,
          entry.has_rank === undefined || entry.has_rank === null ? null : entry.has_rank,
          entry.radio_system || null,
          entry.vtx_type || null,
          entry.vtx_channel || null,
          entry.drone_simulator || null,
          entry.class_75_team === undefined || entry.class_75_team === null ? null : entry.class_75_team,
          entry.class_75_individual === undefined || entry.class_75_individual === null ? null : entry.class_75_individual,
          entry.notes || null,
          entry.external_id || null,
        ]
      );

      const row = rows[0];
      if (row.inserted) {
        results.created.push({ index: i, pilot_id: row.id, fio: entry.fio });
      } else {
        results.updated.push({ index: i, pilot_id: row.id, fio: entry.fio });
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

  return results;
}

module.exports = {
  importPilotEntries,
  parsePilotXlsx,
};
