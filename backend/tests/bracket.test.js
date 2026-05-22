'use strict';

// Unit tests for bracket service. No DB required.
// Verifies tables 3, 4, 6 from Минспорт rules are encoded correctly.

const {
  drawQualificationGroups,
  buildFirstKnockout,
  buildNextKnockout,
  pointsForFlight,
  rankQualificationParticipants,
  shuffle,
} = require('../src/services/bracket');

// Deterministic RNG for shuffle tests.
function lcgRandom(seed = 1) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

describe('drawQualificationGroups', () => {
  test('splits 32 pilots into 8 groups of 4', () => {
    const ids = Array.from({ length: 32 }, (_, i) => i + 1);
    const groups = drawQualificationGroups(ids, { groupSize: 4, random: lcgRandom() });
    expect(groups.length).toBe(8);
    expect(groups[0].slots.length).toBe(4);
    expect(groups.map(g => g.group_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const flat = groups.flatMap(g => g.slots).sort((a, b) => a - b);
    expect(flat).toEqual(ids);
  });

  test('splits 16 pilots into 2 groups of 8', () => {
    const ids = Array.from({ length: 16 }, (_, i) => i + 1);
    const groups = drawQualificationGroups(ids, { groupSize: 8, random: lcgRandom() });
    expect(groups.length).toBe(2);
    expect(groups[0].slots.length).toBe(8);
    expect(groups[1].slots.length).toBe(8);
  });

  test('odd remainder forms a smaller last group', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7]; // 7 → 1 group of 4 + 1 group of 3
    const groups = drawQualificationGroups(ids, { groupSize: 4, random: lcgRandom() });
    expect(groups.length).toBe(2);
    expect(groups[0].slots.length).toBe(4);
    expect(groups[1].slots.length).toBe(3);
  });

  test('empty input → empty result', () => {
    expect(drawQualificationGroups([], { groupSize: 4 })).toEqual([]);
  });

  test('invalid groupSize throws', () => {
    expect(() => drawQualificationGroups([1, 2], { groupSize: 5 })).toThrow();
  });

  test('deterministic with fixed RNG', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = drawQualificationGroups(ids, { groupSize: 4, random: lcgRandom(42) });
    const b = drawQualificationGroups(ids, { groupSize: 4, random: lcgRandom(42) });
    expect(a).toEqual(b);
  });
});

describe('buildFirstKnockout — classes, 32 pilots (Table 3)', () => {
  const ranked = Array.from({ length: 32 }, (_, i) => 100 + i + 1); // 101..132

  test('produces 8 groups of 4 (round_of_16)', () => {
    const { stage_type, groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'two_of_four',
      playoffSize: 32,
      category: 'class',
    });
    expect(stage_type).toBe('round_of_16');
    expect(groups.length).toBe(8);
    expect(groups[0].slots.length).toBe(4);
  });

  test('group 1 = seeds {1, 9, 24, 32} → ids 101, 109, 124, 132', () => {
    const { groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'two_of_four',
      playoffSize: 32,
      category: 'class',
    });
    expect(groups[0].slots).toEqual([101, 109, 124, 132]);
    expect(groups[0]._seeds).toEqual([1, 9, 24, 32]);
  });

  test('group 8 = seeds {2, 10, 23, 31}', () => {
    const { groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'two_of_four',
      playoffSize: 32,
      category: 'class',
    });
    const g8 = groups.find(g => g.group_number === 8);
    expect(g8.slots).toEqual([102, 110, 123, 131]);
  });

  test('not enough qualifiers throws', () => {
    expect(() => buildFirstKnockout({
      rankedQualifiers: ranked.slice(0, 20),
      system: 'two_of_four',
      playoffSize: 32,
      category: 'class',
    })).toThrow(/not enough/);
  });
});

describe('buildFirstKnockout — classes, 16 pilots (Table 4)', () => {
  const ranked = Array.from({ length: 16 }, (_, i) => 200 + i + 1); // 201..216

  test('produces 4 groups of 4 (quarterfinal)', () => {
    const { stage_type, groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'two_of_four',
      playoffSize: 16,
      category: 'class',
    });
    expect(stage_type).toBe('quarterfinal');
    expect(groups.length).toBe(4);
  });

  test('group 1 = seeds {1, 5, 12, 16}', () => {
    const { groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'two_of_four',
      playoffSize: 16,
      category: 'class',
    });
    expect(groups[0].slots).toEqual([201, 205, 212, 216]);
  });

  test('group 4 = seeds {4, 8, 9, 13}', () => {
    const { groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'two_of_four',
      playoffSize: 16,
      category: 'class',
    });
    expect(groups[3].slots).toEqual([204, 208, 209, 213]);
  });
});

describe('buildFirstKnockout — simulator', () => {
  test('4 of 8 system, 32 qualifiers → 4 groups of 8', () => {
    const ranked = Array.from({ length: 32 }, (_, i) => 300 + i + 1);
    const { stage_type, groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'four_of_eight',
      playoffSize: 32,
      category: 'simulator',
    });
    expect(stage_type).toBe('quarterfinal');
    expect(groups.length).toBe(4);
    expect(groups[0].slots).toEqual([301, 305, 309, 313, 317, 321, 325, 329]);
    expect(groups[3].slots).toEqual([304, 308, 312, 316, 320, 324, 328, 332]);
  });

  test('2 of 4 system, 16 qualifiers → 4 groups of 4', () => {
    const ranked = Array.from({ length: 16 }, (_, i) => 400 + i + 1);
    const { stage_type, groups } = buildFirstKnockout({
      rankedQualifiers: ranked,
      system: 'two_of_four',
      playoffSize: 16,
      category: 'simulator',
    });
    expect(stage_type).toBe('quarterfinal');
    expect(groups.length).toBe(4);
    expect(groups[0].slots).toEqual([401, 405, 409, 413]);
  });
});

describe('buildNextKnockout — classes, advance R16 → QF (Table 3)', () => {
  // 8 R16 groups, top 2 from each advance — encode placements as if pilots 1,2 advanced from each.
  const prevGroups = [];
  for (let gn = 1; gn <= 8; gn++) {
    prevGroups.push({
      group_number: gn,
      placements: [
        { place: 1, pilot_id: 1000 + gn * 10 + 1 }, // 1011, 1021, ...
        { place: 2, pilot_id: 1000 + gn * 10 + 2 }, // 1012, 1022, ...
      ],
    });
  }

  test('produces 4 QF groups of 4', () => {
    const { stage_type, groups } = buildNextKnockout({
      prevGroups,
      prevStageType: 'round_of_16',
      system: 'two_of_four',
      category: 'class',
    });
    expect(stage_type).toBe('quarterfinal');
    expect(groups.length).toBe(4);
    expect(groups[0].slots.length).toBe(4);
  });

  test('group 1 = [1-1, 1-5, 2-6, 2-2]', () => {
    const { groups } = buildNextKnockout({
      prevGroups,
      prevStageType: 'round_of_16',
      system: 'two_of_four',
      category: 'class',
    });
    expect(groups[0].slots).toEqual([1011, 1051, 1062, 1022]);
  });

  test('group 4 = [1-6, 1-2, 2-1, 2-5]', () => {
    const { groups } = buildNextKnockout({
      prevGroups,
      prevStageType: 'round_of_16',
      system: 'two_of_four',
      category: 'class',
    });
    expect(groups[3].slots).toEqual([1061, 1021, 1012, 1052]);
  });
});

describe('buildNextKnockout — QF → SF and SF → Final', () => {
  const qfGroups = [
    { group_number: 1, placements: [{ place: 1, pilot_id: 11 }, { place: 2, pilot_id: 12 }] },
    { group_number: 2, placements: [{ place: 1, pilot_id: 21 }, { place: 2, pilot_id: 22 }] },
    { group_number: 3, placements: [{ place: 1, pilot_id: 31 }, { place: 2, pilot_id: 32 }] },
    { group_number: 4, placements: [{ place: 1, pilot_id: 41 }, { place: 2, pilot_id: 42 }] },
  ];

  test('QF → SF: 2 groups of 4 = [[1-1, 1-2, 2-3, 2-4], [1-3, 1-4, 2-1, 2-2]]', () => {
    const { stage_type, groups } = buildNextKnockout({
      prevGroups: qfGroups,
      prevStageType: 'quarterfinal',
      system: 'two_of_four',
      category: 'class',
    });
    expect(stage_type).toBe('semifinal');
    expect(groups[0].slots).toEqual([11, 21, 32, 42]);
    expect(groups[1].slots).toEqual([31, 41, 12, 22]);
  });

  test('SF → Final: 1 group of 4, order = [1-1, 1-2, 2-1, 2-2]', () => {
    const sf = [
      { group_number: 1, placements: [{ place: 1, pilot_id: 'A' }, { place: 2, pilot_id: 'B' }] },
      { group_number: 2, placements: [{ place: 1, pilot_id: 'C' }, { place: 2, pilot_id: 'D' }] },
    ];
    const { stage_type, groups } = buildNextKnockout({
      prevGroups: sf,
      prevStageType: 'semifinal',
      system: 'two_of_four',
      category: 'class',
    });
    expect(stage_type).toBe('final');
    expect(groups.length).toBe(1);
    // Per regulation final layout: 1-1, 1-2, 2-1, 2-2.
    expect(groups[0].slots).toEqual(['A', 'C', 'B', 'D']);
  });
});

describe('buildNextKnockout — simulator 4 of 8', () => {
  // 4 QF groups, top 4 from each advance.
  const qfGroups = [];
  for (let gn = 1; gn <= 4; gn++) {
    qfGroups.push({
      group_number: gn,
      placements: [1, 2, 3, 4].map(p => ({ place: p, pilot_id: gn * 10 + p })),
    });
  }

  test('QF → SF: 2 groups of 8 (Table 6)', () => {
    const { stage_type, groups } = buildNextKnockout({
      prevGroups: qfGroups,
      prevStageType: 'quarterfinal',
      system: 'four_of_eight',
      category: 'simulator',
    });
    expect(stage_type).toBe('semifinal');
    expect(groups.length).toBe(2);
    // Group 1 per regulation: 1-1, 2-1, 3-4, 4-4, 1-2, 2-2, 3-3, 4-3
    //   "place-group" → pilot_id = group*10 + place
    //   1-1=11, 2-1=12, 3-4=43, 4-4=44, 1-2=21, 2-2=22, 3-3=33, 4-3=34
    expect(groups[0].slots).toEqual([11, 12, 43, 44, 21, 22, 33, 34]);
    // Group 2: 1-3, 2-3, 3-2, 4-2, 1-4, 2-4, 3-1, 4-1
    //   1-3=31, 2-3=32, 3-2=23, 4-2=24, 1-4=41, 2-4=42, 3-1=13, 4-1=14
    expect(groups[1].slots).toEqual([31, 32, 23, 24, 41, 42, 13, 14]);
  });

  test('SF → Final: 1 group of 8', () => {
    const sf = [];
    for (let gn = 1; gn <= 2; gn++) {
      sf.push({
        group_number: gn,
        placements: [1, 2, 3, 4].map(p => ({ place: p, pilot_id: gn * 100 + p })),
      });
    }
    const { stage_type, groups } = buildNextKnockout({
      prevGroups: sf,
      prevStageType: 'semifinal',
      system: 'four_of_eight',
      category: 'simulator',
    });
    expect(stage_type).toBe('final');
    expect(groups[0].slots).toEqual([101, 102, 103, 104, 201, 202, 203, 204]);
  });
});

describe('pointsForFlight', () => {
  test('class group of 4: 3/2/1/0', () => {
    expect(pointsForFlight(1, { groupSize: 4, category: 'class' })).toBe(3);
    expect(pointsForFlight(2, { groupSize: 4, category: 'class' })).toBe(2);
    expect(pointsForFlight(3, { groupSize: 4, category: 'class' })).toBe(1);
    expect(pointsForFlight(4, { groupSize: 4, category: 'class' })).toBe(0);
    expect(pointsForFlight(null, { groupSize: 4, category: 'class' })).toBe(0);
  });

  test('simulator group of 4: 4/3/2/1', () => {
    expect(pointsForFlight(1, { groupSize: 4, category: 'simulator' })).toBe(4);
    expect(pointsForFlight(4, { groupSize: 4, category: 'simulator' })).toBe(1);
  });

  test('simulator group of 8: 4/3/2/1 then 0', () => {
    expect(pointsForFlight(1, { groupSize: 8, category: 'simulator' })).toBe(4);
    expect(pointsForFlight(4, { groupSize: 8, category: 'simulator' })).toBe(1);
    expect(pointsForFlight(5, { groupSize: 8, category: 'simulator' })).toBe(0);
    expect(pointsForFlight(8, { groupSize: 8, category: 'simulator' })).toBe(0);
  });
});

describe('rankQualificationParticipants', () => {
  test('laps_time ranks pilots who completed target laps by total time', () => {
    const ranked = rankQualificationParticipants([
      { pilot_id: 1, slot: 1, attendance_status: 'present', qualification_total_laps: 3, qualification_total_time_ms: 32000, qualification_best_lap_ms: 10000 },
      { pilot_id: 2, slot: 2, attendance_status: 'present', qualification_total_laps: 3, qualification_total_time_ms: 29000, qualification_best_lap_ms: 9500 },
      { pilot_id: 3, slot: 3, attendance_status: 'present', qualification_total_laps: 2, qualification_total_time_ms: 18000, qualification_best_lap_ms: 9000 },
      { pilot_id: 4, slot: 4, attendance_status: 'no_show', qualification_total_laps: 3, qualification_total_time_ms: 25000 },
    ], { qualification_mode: 'laps_time', target_laps: 3 });

    expect(ranked).toEqual([2, 1]);
  });

  test('max_laps ranks by laps desc, then total time asc', () => {
    const ranked = rankQualificationParticipants([
      { pilot_id: 1, slot: 1, attendance_status: 'present', qualification_total_laps: 4, qualification_total_time_ms: 61000 },
      { pilot_id: 2, slot: 2, attendance_status: 'present', qualification_total_laps: 5, qualification_total_time_ms: 70000 },
      { pilot_id: 3, slot: 3, attendance_status: 'present', qualification_total_laps: 5, qualification_total_time_ms: 68000 },
      { pilot_id: 4, slot: 4, attendance_status: 'present', qualification_total_laps: 0, qualification_total_time_ms: 0 },
    ], { qualification_mode: 'max_laps', time_limit_seconds: 60 });

    expect(ranked).toEqual([3, 2, 1, 4]);
  });
});

describe('shuffle', () => {
  test('returns a new array of the same length', () => {
    const a = [1, 2, 3, 4, 5];
    const b = shuffle(a, lcgRandom(7));
    expect(b.length).toBe(a.length);
    expect(b.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
