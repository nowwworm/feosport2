'use strict';

// Source of truth for allowed dropdown values in judge registration.
// Mirrors the FormDesigner form 245211
// "Заявка на Участие в Судейском Корпусе".
//
// Used by:
//   - backend/src/schemas/judgeRegistration.js — Zod enum validators
//   - backend/src/routes/admin.js               — bulk import endpoint
//   - frontend admin import UI                  — dropdown options
//
// When FD form values change: update arrays here, no other code changes
// needed.

// Федеральный округ из формы.
const REGIONS = Object.freeze([
  'Центральный',
  'Северо-Западный',
  'Южный',
  'Северо-Кавказский',
  'Приволжский',
  'Уральский',
  'Сибирский',
  'Дальневосточный',
]);

// Судейская категория из формы 245211.
const JUDGE_CATEGORIES = Object.freeze([
  'Национальная',
  'Региональная',
  'Местная',
  'Без категории',
]);

// Дисциплины — что судья готов судить (multi-select из формы).
const JUDGE_DISCIPLINES = Object.freeze([
  'Технический симулятор',
  'ЛЗ/КЗ (класс А)',
  'ЛЗ/КЗ (класс Б)',
  'ЛЗ/КЗ (класс В)',
  'Другая дисциплина (укажите)',
]);

module.exports = {
  REGIONS,
  JUDGE_CATEGORIES,
  JUDGE_DISCIPLINES,
};
