'use strict';

const { z } = require('zod');
const {
  REGIONS,
  JUDGE_CATEGORIES,
  JUDGE_DISCIPLINES,
} = require('../constants/judgeRegistration');
const { parseFio } = require('./pilotRegistration');

const PHONE_REGEX = /^\+?[0-9\s()\-]{7,32}$/;

// One judge entry coming from FormDesigner judge form OR a manual import.
// email + fio + region + category are the only required core fields;
// disciplines/phone/coaching are application-level and may be filled later.
const judgeRegistrationEntrySchema = z.object({
  fio: z.string().min(2, 'FIO must be at least 2 characters').max(300),
  email: z.string().email(),
  phone: z.string().regex(PHONE_REGEX, 'Invalid phone format').nullish(),
  birth_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birth_date must be YYYY-MM-DD')
    .nullish(),

  // "Москва" / "Санкт-Петербург" — enum; "Другой регион" из формы означает
  // что админ должен прислать region_other со свободным текстом.
  // На уровне БД сохраняем region как есть (enum или свободный текст из
  // region_other), region_other нужен только в схеме для отдельного UI поля.
  region: z.enum(REGIONS).nullish(),
  region_other: z.string().max(255).nullish(),

  judge_category: z.enum(JUDGE_CATEGORIES).nullish(),
  judge_disciplines: z.array(z.enum(JUDGE_DISCIPLINES)).default([]),
  has_coaching_experience: z.boolean().nullish(),
  additional_info: z.string().max(2000).nullish(),
  external_id: z.string().max(100).nullish(),
}).refine(
  // Если region = "Другой регион", region_other должен быть непустым.
  data => data.region !== 'Другой регион' || (data.region_other && data.region_other.trim().length > 0),
  { message: 'region_other is required when region is "Другой регион"', path: ['region_other'] }
);

// Bulk-import payload. До 200 судей за один HTTP-запрос (меньше чем пилоты —
// судей просто меньше по количеству, нет смысла раздувать batch).
const judgeImportSchema = z.object({
  entries: z.array(judgeRegistrationEntrySchema).min(1).max(200),
});

// Normalise region: если "Другой регион" → берём region_other как фактический.
// Это упрощает запись в БД — одна колонка users.region содержит итоговую строку.
function normalizeRegion(entry) {
  if (entry.region === 'Другой регион' && entry.region_other) {
    return entry.region_other.trim();
  }
  return entry.region || null;
}

module.exports = {
  judgeRegistrationEntrySchema,
  judgeImportSchema,
  normalizeRegion,
  parseFio,  // reused from pilotRegistration
};
