'use strict';

const { z } = require('zod');
const {
  RADIO_SYSTEMS,
  VTX_TYPES,
  VTX_CHANNELS,
} = require('../constants/pilotRegistration');

// Loose phone regex — Russian forms produce many formats (+7, 8, with/without
// brackets, spaces, dashes). Reject only if there's no plausible digit run.
const PHONE_REGEX = /^\+?[0-9\s()\-]{7,32}$/;

// One participant entry coming from FormDesigner form 245167 OR a manual
// CSV/JSON import. All technical fields nullable — admin may complete data
// incrementally; we want to accept partial entries.
const pilotRegistrationEntrySchema = z.object({
  // Полное ФИО одной строкой ("Фамилия Имя Отчество"); сплитим в parseFio.
  fio: z.string().min(2, 'FIO must be at least 2 characters').max(300),
  email: z.string().email().nullish(),
  phone: z.string().regex(PHONE_REGEX, 'Invalid phone format').nullish(),
  birth_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birth_date must be YYYY-MM-DD')
    .nullish(),
  has_rank: z.boolean().nullish(),
  team: z.string().max(200).nullish(),
  radio_system:    z.enum(RADIO_SYSTEMS).nullish(),
  vtx_type:        z.enum(VTX_TYPES).nullish(),
  vtx_channel:     z.enum(VTX_CHANNELS).nullish(),
  drone_simulator: z.string().max(64).nullish(),
  notes: z.string().nullish(),
  // Optional FD entry id (used as upsert key for dedup).
  external_id: z.string().max(100).nullish(),
});

// Bulk-import payload. Max 500 entries — one HTTP request can carry a season's
// worth of registrations, but not so much that we'd time out on per-entry
// validation.
const pilotImportSchema = z.object({
  entries: z.array(pilotRegistrationEntrySchema).min(1).max(500),
});

// Split "Фамилия Имя Отчество" → 3 fields. Matches the historic logic in
// sync-formdesigner.js so a re-sync produces identical rows.
function parseFio(fio) {
  if (!fio) return { last_name: '', first_name: '', middle_name: null };
  const parts = fio.trim().split(/\s+/);
  return {
    last_name:   parts[0] || '',
    first_name:  parts[1] || parts[0] || '',
    middle_name: parts[2] || null,
  };
}

module.exports = {
  pilotRegistrationEntrySchema,
  pilotImportSchema,
  parseFio,
};
