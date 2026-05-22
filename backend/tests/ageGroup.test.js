'use strict';

// Unit tests for age-group eligibility per Минспорт §2.1.
// No DB required.

const { ageAt, ageInCalendarYear, checkEligibility } = require('../src/services/ageGroup');

const GROUP_10_17 = { code: 'juniors_10_17',  min_age: 10, max_age: 17,  age_check: 'day_of_start'  };
const GROUP_17_25 = { code: 'juniors_17_25',  min_age: 17, max_age: 25,  age_check: 'calendar_year' };
const GROUP_14P   = { code: 'adults_14_plus', min_age: 14, max_age: null, age_check: 'calendar_year' };

describe('ageAt', () => {
  test('exact-birthday boundary', () => {
    expect(ageAt('2010-06-15', '2026-06-15')).toBe(16);
    expect(ageAt('2010-06-15', '2026-06-14')).toBe(15);
    expect(ageAt('2010-06-15', '2026-06-16')).toBe(16);
  });
});

describe('ageInCalendarYear', () => {
  test('is purely a year subtraction', () => {
    // Will be 12 in 2026 regardless of date within the year.
    expect(ageInCalendarYear('2014-12-31', '2026-01-01')).toBe(12);
    expect(ageInCalendarYear('2014-01-01', '2026-12-31')).toBe(12);
  });
});

describe('checkEligibility — juniors 10-17 (day_of_start min, calendar_year max)', () => {
  test('10th birthday after start date — rejected (still 9 on start)', () => {
    // Born 2016-08-15, start 2026-06-15 → ageAt = 9 (below min 10).
    const v = checkEligibility('2016-08-15', '2026-06-15', GROUP_10_17);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('below_min_age');
  });

  test('10th birthday on start date — accepted', () => {
    const v = checkEligibility('2016-06-15', '2026-06-15', GROUP_10_17);
    expect(v.ok).toBe(true);
  });

  test('turns 18 in same calendar year — accepted (calendar_year max = 18 OK iff 17)', () => {
    // Born 2008-12-31, start 2026-06-15 → ageAt = 17, calendar_year = 18.
    // Calendar year max is 17 → 18 > 17 → rejected.
    const v = checkEligibility('2008-12-31', '2026-06-15', GROUP_10_17);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('above_max_age');
  });

  test('17 on start day, turns 17 in calendar year — accepted', () => {
    // Born 2009-01-15, start 2026-06-15 → ageAt = 17, calendar_year = 17.
    const v = checkEligibility('2009-01-15', '2026-06-15', GROUP_10_17);
    expect(v.ok).toBe(true);
  });

  test('16 on start day, turns 17 later same year — accepted', () => {
    // Born 2009-09-01, start 2026-06-15 → ageAt = 16, calendar_year = 17.
    const v = checkEligibility('2009-09-01', '2026-06-15', GROUP_10_17);
    expect(v.ok).toBe(true);
  });
});

describe('checkEligibility — adults 14+ (calendar_year)', () => {
  test('turns 14 in calendar year (before start) — accepted', () => {
    // Born 2012-08-01, start 2026-06-15 → calendar_year = 14. min ok.
    const v = checkEligibility('2012-08-01', '2026-06-15', GROUP_14P);
    expect(v.ok).toBe(true);
  });

  test('turns 13 in calendar year — rejected', () => {
    const v = checkEligibility('2013-08-01', '2026-06-15', GROUP_14P);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('below_min_age');
  });

  test('no upper limit', () => {
    const v = checkEligibility('1960-01-01', '2026-06-15', GROUP_14P);
    expect(v.ok).toBe(true);
  });
});

describe('checkEligibility — juniors 17-25 (calendar_year)', () => {
  test('exactly 17 in calendar year — accepted', () => {
    const v = checkEligibility('2009-12-31', '2026-06-15', GROUP_17_25);
    expect(v.ok).toBe(true);
  });

  test('turns 25 in calendar year — accepted', () => {
    const v = checkEligibility('2001-01-01', '2026-06-15', GROUP_17_25);
    expect(v.ok).toBe(true);
  });

  test('turns 26 in calendar year — rejected', () => {
    const v = checkEligibility('2000-01-01', '2026-06-15', GROUP_17_25);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('above_max_age');
  });

  test('turns 16 in calendar year — rejected', () => {
    const v = checkEligibility('2010-01-01', '2026-06-15', GROUP_17_25);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('below_min_age');
  });
});

describe('checkEligibility — error cases', () => {
  test('null ageGroup', () => {
    const v = checkEligibility('2010-01-01', '2026-06-15', null);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('age_group_required');
  });

  test('unknown age_check mode', () => {
    const v = checkEligibility('2010-01-01', '2026-06-15',
      { code: 'x', min_age: 10, max_age: 17, age_check: 'lunar' });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('unknown_age_check:lunar');
  });
});
