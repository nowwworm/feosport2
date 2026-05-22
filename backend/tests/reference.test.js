'use strict';

// Tests for reference catalogue endpoints (disciplines, age groups, channels,
// drone specs). Validates that seed data from Минспорт rules is correctly
// exposed via the API.

const request = require('supertest');
const app = require('../src/app');
const { pool, cleanupDB, seedBaselineData, getAllUsers } = require('./helpers/testDB');
const { authHeader } = require('./helpers/jwt');

describe('Reference catalogues', () => {
  let judgeUser;

  beforeAll(async () => {
    await seedBaselineData();
    const users = await getAllUsers();
    judgeUser = users.find(u => u.role === 'judge');
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('GET /api/reference/disciplines', () => {
    test('Requires authentication', async () => {
      const res = await request(app).get('/api/reference/disciplines');
      expect(res.statusCode).toBe(401);
    });

    test('Returns 8 official disciplines from ВРВС', async () => {
      const res = await request(app)
        .get('/api/reference/disciplines')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(8);

      const codes = res.body.map(d => d.code).sort();
      expect(codes).toEqual([
        'class_200mm',
        'class_200mm_team',
        'class_330mm',
        'class_330mm_team',
        'class_75mm',
        'class_75mm_team',
        'simulator',
        'simulator_team',
      ]);
    });

    test('Disciplines have expected shape', async () => {
      const res = await request(app)
        .get('/api/reference/disciplines')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      const class75 = res.body.find(d => d.code === 'class_75mm');
      expect(class75).toMatchObject({
        name_ru: 'класс 75 мм',
        category: 'class',
        drone_class: '75mm',
        is_team: false,
      });

      const simTeam = res.body.find(d => d.code === 'simulator_team');
      expect(simTeam.category).toBe('simulator');
      expect(simTeam.drone_class).toBeNull();
      expect(simTeam.is_team).toBe(true);
    });
  });

  describe('GET /api/reference/race-systems', () => {
    test('Returns "2 of 4" and "4 of 8" systems', async () => {
      const res = await request(app)
        .get('/api/reference/race-systems')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(2);

      const twoOfFour = res.body.find(s => s.code === 'two_of_four');
      expect(twoOfFour).toMatchObject({ group_size: 4, advance_count: 2 });

      const fourOfEight = res.body.find(s => s.code === 'four_of_eight');
      expect(fourOfEight).toMatchObject({ group_size: 8, advance_count: 4 });
    });
  });

  describe('GET /api/reference/age-groups', () => {
    test('Returns 3 official age groups', async () => {
      const res = await request(app)
        .get('/api/reference/age-groups')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(3);

      const codes = res.body.map(g => g.code).sort();
      expect(codes).toEqual(['adults_14_plus', 'juniors_10_17', 'juniors_17_25']);

      const juniors = res.body.find(g => g.code === 'juniors_10_17');
      expect(juniors.age_check).toBe('day_of_start');

      const adults = res.body.find(g => g.code === 'adults_14_plus');
      expect(adults.max_age).toBeNull();
    });
  });

  describe('GET /api/reference/video-channels', () => {
    test('Returns 8 R-band 5.8 GHz channels', async () => {
      const res = await request(app)
        .get('/api/reference/video-channels')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(8);
      expect(res.body.every(c => c.band === 'R')).toBe(true);

      const r1 = res.body.find(c => c.code === 'R1');
      expect(r1.frequency_mhz).toBe(5658);

      const r8 = res.body.find(c => c.code === 'R8');
      expect(r8.frequency_mhz).toBe(5917);
    });
  });

  describe('GET /api/reference/drone-specs', () => {
    test('Returns specs for 3 drone classes', async () => {
      const res = await request(app)
        .get('/api/reference/drone-specs')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(3);

      const classes = res.body.map(s => s.drone_class).sort();
      expect(classes).toEqual(['200mm', '330mm', '75mm']);
    });

    test('75mm spec matches Таблица 10', async () => {
      const res = await request(app)
        .get('/api/reference/drone-specs/75mm')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        drone_class: '75mm',
        max_takeoff_weight_g: 50,
        min_diagonal_mm: 65,
        max_diagonal_mm: 75,
        requires_prop_guards: true,
        requires_failsafe: true,
        battery_cells: 1,
        battery_max_capacity_mah: 550,
      });
      // numeric columns come back as strings from pg
      expect(Number(res.body.battery_max_cell_voltage)).toBe(4.35);
    });

    test('200mm spec matches Таблица 10', async () => {
      const res = await request(app)
        .get('/api/reference/drone-specs/200mm')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        drone_class: '200mm',
        max_takeoff_weight_g: 650,
        min_diagonal_mm: 180,
        max_diagonal_mm: 250,
        min_leds: 40,
        battery_cells: 6,
        battery_max_capacity_mah: 1500,
      });
      expect(Number(res.body.max_propeller_inches)).toBe(5.1);
    });

    test('330mm spec requires minimum weight 850g', async () => {
      const res = await request(app)
        .get('/api/reference/drone-specs/330mm')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(200);
      expect(res.body.min_takeoff_weight_g).toBe(850);
      expect(res.body.motor_max_kv).toBe(2000);
      expect(Number(res.body.max_propeller_inches)).toBe(7);
    });

    test('Returns 404 for unknown drone class', async () => {
      const res = await request(app)
        .get('/api/reference/drone-specs/999mm')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(404);
    });
  });
});
