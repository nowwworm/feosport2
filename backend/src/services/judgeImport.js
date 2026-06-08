'use strict';

const { randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const pool = require('../config/db');
const {
  judgeRegistrationEntrySchema,
  normalizeRegion,
  parseFio,
} = require('../schemas/judgeRegistration');
const { JUDGE_DISCIPLINES } = require('../constants/judgeRegistration');

const DISCIPLINE_BY_HEADER = new Map([
  ['техническийсимулятор', 'Технический симулятор'],
  ['лзкзкласса', 'ЛЗ/КЗ (класс А)'],
  ['лзкзклассa', 'ЛЗ/КЗ (класс А)'],
  ['лзкзклассб', 'ЛЗ/КЗ (класс Б)'],
  ['лзкзклассb', 'ЛЗ/КЗ (класс Б)'],
  ['лзкзклассв', 'ЛЗ/КЗ (класс В)'],
  ['лзкзклассv', 'ЛЗ/КЗ (класс В)'],
  ['другаядисциплинаукажите', 'Другая дисциплина (укажите)'],
]);

const HEADER_ALIASES = new Map([
  ['fio', 'fio'],
  ['фио', 'fio'],
  ['фамилияимяотчество', 'fio'],
  ['фамилияимя', 'fio'],

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

  ['region', 'region'],
  ['регион', 'region'],
  ['федеральныйокруг', 'region'],
  ['округ', 'region'],

  ['judgecategory', 'judge_category'],
  ['judge_category', 'judge_category'],
  ['категориясудьи', 'judge_category'],
  ['судейскаякатегория', 'judge_category'],
  ['категория', 'judge_category'],

  ['coachingexperienceyears', 'coaching_experience_years'],
  ['coaching_experience_years', 'coaching_experience_years'],
  ['опыттренерскойработылет', 'coaching_experience_years'],
  ['тренерскийопытлет', 'coaching_experience_years'],
  ['опытработылет', 'coaching_experience_years'],

  ['disciplines', 'judge_disciplines'],
  ['judge_disciplines', 'judge_disciplines'],
  ['дисциплиныдлясудейства', 'judge_disciplines'],
  ['дисциплины', 'judge_disciplines'],

  ['additionalinfo', 'additional_info'],
  ['additional_info', 'additional_info'],
  ['дополнительнаяинформация', 'additional_info'],
  ['допинформация', 'additional_info'],
  ['примечание', 'additional_info'],
  ['примечания', 'additional_info'],

  ['externalid', 'external_id'],
  ['external_id', 'external_id'],
  ['idcrm', 'external_id'],
  ['crm_id', 'external_id'],
  ['id_crm', 'external_id'],
  ['fdid', 'external_id'],
  ['formdesignerid', 'external_id'],
  ['idзаявки', 'external_id'],
  ['idответа', 'external_id'],
]);

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s"'`.,;:()[\]{}<>/\\|+-]/g, '');
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

function normalizeTruthy(value) {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase().replace(/ё/g, 'е');
  return ['да', 'yes', 'true', '1', 'есть', 'выбрано', 'x', '+'].includes(s);
}

function normalizeDisciplines(value) {
  if (Array.isArray(value)) return value;
  const raw = cellToValue(value);
  if (raw === '') return [];
  return String(raw)
    .split(/[,;\n\r]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((item) => {
      const key = normalizeHeader(item);
      return DISCIPLINE_BY_HEADER.get(key) || item;
    })
    .filter(item => JUDGE_DISCIPLINES.includes(item));
}

function normalizeCell(field, value) {
  const raw = cellToValue(value);
  if (raw === '') return null;
  if (field === 'birth_date') {
    const serial = excelSerialToDate(raw);
    if (serial) return serial;
  }
  if (field === 'coaching_experience_years') {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  if (field === 'judge_disciplines') return normalizeDisciplines(raw);
  return String(raw).trim();
}

function rowIsEmpty(entry) {
  return Object.values(entry).every((value) => {
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === '';
  });
}

async function parseJudgeXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('xlsx_first_sheet_required');

  const columns = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const headerKey = normalizeHeader(cellToValue(cell.value));
    const alias = HEADER_ALIASES.get(headerKey);
    const discipline = DISCIPLINE_BY_HEADER.get(headerKey);
    if (alias) columns.push({ colNumber, key: alias });
    if (discipline) columns.push({ colNumber, key: 'judge_disciplines', discipline });
  });

  if (!columns.some(col => col.key === 'email')) {
    throw new Error('xlsx_header_email_required');
  }

  const entries = [];
  const rowNumbers = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry = {};
    for (const { colNumber, key, discipline } of columns) {
      if (discipline) {
        if (normalizeTruthy(row.getCell(colNumber).value)) {
          entry.judge_disciplines = entry.judge_disciplines || [];
          entry.judge_disciplines.push(discipline);
        }
        continue;
      }
      const value = normalizeCell(key, row.getCell(colNumber).value);
      if (key === 'judge_disciplines') {
        entry.judge_disciplines = [
          ...(entry.judge_disciplines || []),
          ...normalizeDisciplines(value),
        ];
      } else {
        entry[key] = value;
      }
    }
    if (entry.judge_disciplines) {
      entry.judge_disciplines = [...new Set(entry.judge_disciplines)];
    }
    if (rowIsEmpty(entry)) return;
    entries.push(entry);
    rowNumbers.push(rowNumber);
  });

  return { entries, rowNumbers };
}

async function fetchUser(whereSql, params) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.external_id, r.name AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE ${whereSql}
      LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function importJudgeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    const error = new Error('entries[] array required (1..200 records)');
    error.status = 400;
    throw error;
  }
  if (entries.length > 200) {
    const error = new Error('Too many entries - split into batches of 200');
    error.status = 400;
    throw error;
  }

  const { rows: roleRows } = await pool.query(
    `SELECT id FROM roles WHERE name = 'judge' LIMIT 1`
  );
  if (!roleRows.length) {
    const error = new Error('Role "judge" not found');
    error.status = 500;
    throw error;
  }
  const judgeRoleId = roleRows[0].id;

  const created = [];
  const updated = [];
  const errors = [];

  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i];
    const parsed = judgeRegistrationEntrySchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        index: i,
        entry: raw,
        email: raw?.email || null,
        issues: parsed.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        reason: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      });
      continue;
    }

    const data = parsed.data;
    const fio = parseFio(data.fio);
    const region = normalizeRegion(data);
    const email = data.email.toLowerCase().trim();
    const externalId = data.external_id?.trim() || null;
    const judgeDisciplines = data.judge_disciplines && data.judge_disciplines.length > 0
      ? data.judge_disciplines
      : null;
    const coachingYears = data.coaching_experience_years ?? null;
    const hasCoachingExperience = data.has_coaching_experience ?? (
      coachingYears === null ? null : coachingYears > 0
    );

    try {
      const existingByExternalId = externalId
        ? await fetchUser('u.external_id = $1', [externalId])
        : null;
      const existingByEmail = await fetchUser('LOWER(u.email) = $1', [email]);

      for (const [key, existing] of [
        ['external_id', existingByExternalId],
        ['email', existingByEmail],
      ]) {
        if (existing && existing.role !== 'judge') {
          throw new Error(`${key} belongs to existing non-judge user (${existing.email}, role=${existing.role})`);
        }
      }

      if (
        existingByExternalId &&
        existingByEmail &&
        existingByExternalId.id !== existingByEmail.id
      ) {
        throw new Error(`email belongs to a different user (${existingByEmail.email}) than external_id (${externalId})`);
      }

      if (
        externalId &&
        !existingByExternalId &&
        existingByEmail?.external_id &&
        existingByEmail.external_id !== externalId
      ) {
        throw new Error(`email belongs to judge with different external_id (${existingByEmail.external_id})`);
      }

      const existingUser = existingByExternalId || existingByEmail;

      if (existingUser) {
        const { rows } = await pool.query(
          `UPDATE users SET
              email                     = $1,
              role_id                   = $2,
              first_name                = $3,
              last_name                 = $4,
              middle_name               = $5,
              birth_date                = $6,
              phone                     = $7,
              region                    = $8,
              judge_category            = $9,
              judge_disciplines         = $10,
              has_coaching_experience   = $11,
              coaching_experience_years = $12,
              additional_info           = $13,
              external_id               = COALESCE($14, external_id),
              updated_at                = NOW()
            WHERE id = $15
            RETURNING id, email`,
          [
            email,
            judgeRoleId,
            fio.first_name || null,
            fio.last_name || null,
            fio.middle_name,
            data.birth_date || null,
            data.phone || null,
            region,
            data.judge_category || null,
            judgeDisciplines,
            hasCoachingExperience,
            coachingYears,
            data.additional_info || null,
            externalId,
            existingUser.id,
          ]
        );
        updated.push({ id: rows[0].id, email: rows[0].email, index: i, fio: data.fio || null });
      } else {
        const tempPwd = randomBytes(8).toString('hex');
        const pwdHash = await bcrypt.hash(tempPwd, 10);
        const { rows } = await pool.query(
          `INSERT INTO users (
              email, password_hash, role_id, is_active,
              first_name, last_name, middle_name, birth_date, phone,
              region, judge_category, judge_disciplines,
              has_coaching_experience, coaching_experience_years,
              additional_info, external_id
           ) VALUES (
              $1, $2, $3, true,
              $4, $5, $6, $7, $8,
              $9, $10, $11,
              $12, $13,
              $14, $15
           )
           RETURNING id, email`,
          [
            email,
            pwdHash,
            judgeRoleId,
            fio.first_name || null,
            fio.last_name || null,
            fio.middle_name,
            data.birth_date || null,
            data.phone || null,
            region,
            data.judge_category || null,
            judgeDisciplines,
            hasCoachingExperience,
            coachingYears,
            data.additional_info || null,
            externalId,
          ]
        );
        created.push({ id: rows[0].id, email: rows[0].email, index: i, fio: data.fio || null });
      }
    } catch (err) {
      errors.push({
        index: i,
        entry: data,
        email,
        issues: [{ path: '', message: err.message }],
        reason: err.message,
      });
    }
  }

  return { created, updated, errors };
}

module.exports = {
  importJudgeEntries,
  parseJudgeXlsx,
};
