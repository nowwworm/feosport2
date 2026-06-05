'use strict';

const { z } = require('zod');
const {
  REGIONS,
  JUDGE_CATEGORIES,
  JUDGE_DISCIPLINES,
} = require('../constants/judgeRegistration');
const { parseFio } = require('./pilotRegistration');

const PHONE_REGEX = /^\+?[0-9\s()\-]{7,32}$/;

function optionalInteger(min, max, message) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return undefined;
      return Number(value);
    },
    z.number().int(message).min(min).max(max).optional()
  );
}

// One judge entry coming from FormDesigner form 245211 OR a manual import.
// Form 245211 does not require a full name in the visible fields, so fio is
// optional here; if present, it is split into users first/last/middle names.
const judgeRegistrationEntrySchema = z.object({
  fio: z.string().min(2, 'FIO must be at least 2 characters').max(300).nullish(),
  email: z.string().email(),
  phone: z.string().regex(PHONE_REGEX, 'Invalid phone format').nullish(),
  birth_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birth_date must be YYYY-MM-DD')
    .nullish(),

  // Федеральный округ.
  region: z.enum(REGIONS).nullish(),

  judge_category: z.enum(JUDGE_CATEGORIES).nullish(),
  judge_disciplines: z.array(z.enum(JUDGE_DISCIPLINES)).default([]),
  coaching_experience_years: optionalInteger(0, 80, 'coaching_experience_years must be an integer'),
  has_coaching_experience: z.boolean().nullish(),
  additional_info: z.string().max(2000).nullish(),
  external_id: z.string().max(100).nullish(),
});

// Bulk-import payload. До 200 судей за один HTTP-запрос (меньше чем пилоты —
// судей просто меньше по количеству, нет смысла раздувать batch).
const judgeImportSchema = z.object({
  entries: z.array(judgeRegistrationEntrySchema).min(1).max(200),
});

function normalizeRegion(entry) {
  return entry.region || null;
}

module.exports = {
  judgeRegistrationEntrySchema,
  judgeImportSchema,
  normalizeRegion,
  parseFio,  // reused from pilotRegistration
};
