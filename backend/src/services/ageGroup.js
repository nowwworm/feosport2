'use strict';

// Age-group eligibility per Минспорт rules §2.1.
//
// Rules text (paraphrased):
//   * Юниоры 10-17: МИНИМАЛЬНЫЙ возраст должен быть достигнут на день начала
//     соревнования; МАКСИМАЛЬНЫЙ — в календарный год проведения.
//   * Юниоры 17-25 / Мужчины и женщины 14+: установленный возраст должен быть
//     достигнут в КАЛЕНДАРНЫЙ ГОД проведения соревнования.
//
// `ageGroup` shape (from `age_groups` table):
//   { code, min_age, max_age, age_check }
//   age_check ∈ { 'day_of_start', 'calendar_year' }
//   max_age may be null (e.g. 14+).

function parseDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'string') return new Date(input);
  throw new TypeError(`Expected Date or ISO string, got ${typeof input}`);
}

// Возраст «исполнилось N лет к этой дате» — целое число.
function ageAt(birthDate, atDate) {
  const b = parseDate(birthDate);
  const a = parseDate(atDate);
  let years = a.getUTCFullYear() - b.getUTCFullYear();
  const monthDiff = a.getUTCMonth() - b.getUTCMonth();
  const dayDiff   = a.getUTCDate()  - b.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years -= 1;
  return years;
}

// Возраст, который пилот ДОСТИГНЕТ В КАЛЕНДАРНЫЙ ГОД (любой день этого года).
// Эквивалент: год соревнования − год рождения.
function ageInCalendarYear(birthDate, atDate) {
  const b = parseDate(birthDate);
  const a = parseDate(atDate);
  return a.getUTCFullYear() - b.getUTCFullYear();
}

/**
 * Check whether a pilot is eligible for a given age group at a given competition.
 *
 * @param {Date|string} birthDate     — pilot DOB
 * @param {Date|string} startDate     — competition start date
 * @param {{code: string, min_age: number, max_age: number|null, age_check: string}} ageGroup
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function checkEligibility(birthDate, startDate, ageGroup) {
  if (!ageGroup) return { ok: false, reason: 'age_group_required' };

  const ageDayOfStart  = ageAt(birthDate, startDate);
  const ageCalendarYear = ageInCalendarYear(birthDate, startDate);

  let effectiveMinAge;
  let effectiveMaxAge;

  if (ageGroup.age_check === 'day_of_start') {
    // Юниоры 10-17: min на день начала, max в календарный год.
    effectiveMinAge = ageDayOfStart;
    effectiveMaxAge = ageCalendarYear;
  } else if (ageGroup.age_check === 'calendar_year') {
    // Все остальные: и min, и max — в календарный год.
    effectiveMinAge = ageCalendarYear;
    effectiveMaxAge = ageCalendarYear;
  } else {
    return { ok: false, reason: `unknown_age_check:${ageGroup.age_check}` };
  }

  if (effectiveMinAge < ageGroup.min_age) {
    return { ok: false, reason: 'below_min_age' };
  }
  if (ageGroup.max_age != null && effectiveMaxAge > ageGroup.max_age) {
    return { ok: false, reason: 'above_max_age' };
  }
  return { ok: true };
}

module.exports = { ageAt, ageInCalendarYear, checkEligibility };
