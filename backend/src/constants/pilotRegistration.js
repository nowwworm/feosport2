'use strict';

// Source of truth for allowed dropdown values in pilot registration.
// Mirrors FormDesigner form 245167 (https://formdesigner.ru/form/view/245167).
//
// Used by:
//   - backend/src/schemas/pilotRegistration.js — Zod enum validators
//   - backend/scripts/sync-formdesigner.js     — validation before upsert
//   - frontend admin import UI                 — populating <Select> dropdowns
//
// When FD form values change: update arrays here, no other code changes needed.

const RADIO_SYSTEMS = Object.freeze([
  'TBS Tracer 2,4GHz',
  'TBS Crossfire 915MHz',
  'ELRS 2,4GHz',
  'ELRS 915MHz',
  'FrSky',
  'FlySky',
  'Futaba',
]);

const VTX_TYPES = Object.freeze([
  'Аналог, 5,8GHz',
  'HD Zero',
  'DJI Air Unit',
]);

const VTX_CHANNELS = Object.freeze(['R1', 'R3', 'R6', 'R7']);

module.exports = {
  RADIO_SYSTEMS,
  VTX_TYPES,
  VTX_CHANNELS,
};
