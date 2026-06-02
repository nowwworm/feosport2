'use strict';

// Source of truth for allowed dropdown values in judge registration.
// Mirrors the FormDesigner "Регистрация Судьи на Соревнования" form.
//
// Used by:
//   - backend/src/schemas/judgeRegistration.js — Zod enum validators
//   - backend/src/routes/admin.js               — bulk import endpoint
//   - frontend admin import UI                  — dropdown options
//
// When FD form values change: update arrays here, no other code changes
// needed.

// Регион проживания — три фиксированных опции; при "Другой регион" UI должен
// открыть текстовое поле и сохранить вписанное в users.region как есть.
const REGIONS = Object.freeze([
  'Москва',
  'Санкт-Петербург',
  'Другой регион',
]);

// Судейская категория — 4 уровня (Всероссийская — высшая, далее по нисходящей).
const JUDGE_CATEGORIES = Object.freeze([
  'Всероссийская',
  '1',
  '2',
  '3',
]);

// Дисциплины — что судья готов судить (multi-select из формы).
const JUDGE_DISCIPLINES = Object.freeze([
  'Технический симулятор',
  'Класс 75 ЛЗ/КЗ',
  'Класс 200 ЛЗ/КЗ',
  'Класс 330 ЛЗ/КЗ',
]);

module.exports = {
  REGIONS,
  JUDGE_CATEGORIES,
  JUDGE_DISCIPLINES,
};
