'use strict';

const {
  pointsForPlace,
  computeGroupScores,
  winsBonus,
  computeStageStandings,
  detectTiesAtSamePoints,
} = require('../src/services/scoring');

describe('pointsForPlace', () => {
  test('4-pilot group: 3/2/1/0', () => {
    expect(pointsForPlace(1, 4)).toBe(3);
    expect(pointsForPlace(2, 4)).toBe(2);
    expect(pointsForPlace(3, 4)).toBe(1);
    expect(pointsForPlace(4, 4)).toBe(0);
  });

  test('8-pilot group: 4/3/2/1/0', () => {
    expect(pointsForPlace(1, 8)).toBe(4);
    expect(pointsForPlace(2, 8)).toBe(3);
    expect(pointsForPlace(3, 8)).toBe(2);
    expect(pointsForPlace(4, 8)).toBe(1);
    expect(pointsForPlace(5, 8)).toBe(0);
    expect(pointsForPlace(8, 8)).toBe(0);
  });

  test('null/zero place yields 0 points', () => {
    expect(pointsForPlace(null, 4)).toBe(0);
    expect(pointsForPlace(0, 4)).toBe(0);
  });
});

describe('winsBonus', () => {
  test('+1 in 4/4 system when pilot has ≥2 wins', () => {
    expect(winsBonus(2, 'four_of_four')).toBe(1);
    expect(winsBonus(3, 'four_of_four')).toBe(1);
  });
  test('0 in 4/4 system with <2 wins', () => {
    expect(winsBonus(1, 'four_of_four')).toBe(0);
    expect(winsBonus(0, 'four_of_four')).toBe(0);
  });
  test('0 in other systems regardless of wins', () => {
    expect(winsBonus(3, 'two_of_four')).toBe(0);
    expect(winsBonus(3, 'four_of_eight')).toBe(0);
  });
});

describe('computeGroupScores', () => {
  test('decorates participants with computed points', () => {
    const out = computeGroupScores([
      { pilot_id: 1, finish_place: 1 },
      { pilot_id: 2, finish_place: 2 },
      { pilot_id: 3, finish_place: 3 },
      { pilot_id: 4, finish_place: 4 },
    ], 4);
    expect(out.map(p => p.points)).toEqual([3, 2, 1, 0]);
  });
});

describe('computeStageStandings', () => {
  test('sums points across multiple groups, sorted descending', () => {
    const groups = [
      {
        id: 10, group_number: 1, group_size: 4,
        participants: [
          { pilot_id: 1, finish_place: 1 },
          { pilot_id: 2, finish_place: 2 },
          { pilot_id: 3, finish_place: 3 },
          { pilot_id: 4, finish_place: 4 },
        ],
      },
      {
        id: 11, group_number: 2, group_size: 4,
        participants: [
          { pilot_id: 1, finish_place: 1 },  // pilot 1 in both groups, both 1st
          { pilot_id: 5, finish_place: 2 },
          { pilot_id: 6, finish_place: 3 },
          { pilot_id: 7, finish_place: 4 },
        ],
      },
    ];
    const out = computeStageStandings(groups, 'two_of_four');
    // pilot 1 → 3 + 3 = 6 (no bonus in 2/4)
    expect(out[0].pilot_id).toBe(1);
    expect(out[0].total_points).toBe(6);
    expect(out[0].wins).toBe(2);
    expect(out[0].bonus).toBe(0);
  });

  test('applies +1 wins bonus in 4/4 system', () => {
    const groups = [
      {
        id: 10, group_number: 1, group_size: 4,
        participants: [{ pilot_id: 1, finish_place: 1 }],
      },
      {
        id: 11, group_number: 2, group_size: 4,
        participants: [{ pilot_id: 1, finish_place: 1 }],
      },
    ];
    const out = computeStageStandings(groups, 'four_of_four');
    // 3 + 3 + 1 bonus = 7
    expect(out[0].total_points).toBe(7);
    expect(out[0].bonus).toBe(1);
  });

  test('handles team-based participants (team_id without pilot_id)', () => {
    const groups = [{
      id: 10, group_number: 1, group_size: 4,
      participants: [
        { team_id: 100, finish_place: 1 },
        { team_id: 200, finish_place: 2 },
      ],
    }];
    const out = computeStageStandings(groups, 'two_of_four');
    expect(out[0].team_id).toBe(100);
    expect(out[0].total_points).toBe(3);
  });
});

describe('detectTiesAtSamePoints', () => {
  test('finds pilots tied at the same points (≥2)', () => {
    const standings = [
      { pilot_id: 1, total_points: 5 },
      { pilot_id: 2, total_points: 5 },
      { pilot_id: 3, total_points: 4 },
      { pilot_id: 4, total_points: 4 },
      { pilot_id: 5, total_points: 4 },
      { pilot_id: 6, total_points: 2 },
    ];
    const ties = detectTiesAtSamePoints(standings);
    expect(ties.length).toBe(2);
    expect(ties.find(t => t.points === 5).entries.length).toBe(2);
    expect(ties.find(t => t.points === 4).entries.length).toBe(3);
  });

  test('no ties when all unique', () => {
    expect(detectTiesAtSamePoints([
      { pilot_id: 1, total_points: 5 },
      { pilot_id: 2, total_points: 4 },
    ])).toEqual([]);
  });
});
