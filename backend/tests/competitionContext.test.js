'use strict';

const {
  isSimulator, isPhysicalClass, isTeam,
} = require('../src/services/competitionContext');

describe('competitionContext predicates', () => {
  test('isSimulator true only for simulator category', () => {
    expect(isSimulator({ discipline_category: 'simulator' })).toBe(true);
    expect(isSimulator({ discipline_category: 'class' })).toBe(false);
    expect(isSimulator({ discipline_category: null })).toBe(false);
    expect(isSimulator(null)).toBe(false);
  });

  test('isPhysicalClass true only for class category', () => {
    expect(isPhysicalClass({ discipline_category: 'class' })).toBe(true);
    expect(isPhysicalClass({ discipline_category: 'simulator' })).toBe(false);
    expect(isPhysicalClass(null)).toBe(false);
  });

  test('isTeam tracks discipline_is_team flag', () => {
    expect(isTeam({ discipline_is_team: true })).toBe(true);
    expect(isTeam({ discipline_is_team: false })).toBe(false);
    expect(isTeam({ discipline_is_team: null })).toBe(false);
    expect(isTeam(null)).toBe(false);
  });
});
