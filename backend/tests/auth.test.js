'use strict';

const request = require('supertest');
const app = require('../src/app');
const { pool, cleanupDB, seedBaselineData, createTestUser, getAllUsers } = require('./helpers/testDB');
const { generateToken, authHeader } = require('./helpers/jwt');

describe('Authentication & Authorization', () => {
  beforeAll(async () => {
    await seedBaselineData();
  });

  afterEach(async () => {
    // Keep baseline users, just clear new test data
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['test_%@feosport.local']);
  });

  afterAll(async () => {
    await cleanupDB();
    await pool.end();
  });

  describe('POST /api/auth/login', () => {
    test('Valid credentials returns JWT token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@feosport.local',
          password: 'password123'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.token).toMatch(/^eyJ/); // JWT starts with 'eyJ'
    });

    test('Invalid password returns 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@feosport.local',
          password: 'wrongpassword'
        });

      expect(res.statusCode).toBe(401);
    });

    test('Non-existent user returns 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@feosport.local',
          password: 'password123'
        });

      expect(res.statusCode).toBe(401);
    });

    test('Missing email returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          password: 'password123'
        });

      expect(res.statusCode).toBe(400);
    });

    test('Missing password returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@feosport.local'
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/register', () => {
    async function adminAuth() {
      const users = await getAllUsers();
      const adminUser = users.find(u => u.role === 'admin');
      return authHeader(adminUser.id, 'admin');
    }

    test('Unauthenticated registration is rejected', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test_anonreg@feosport.local',
          password: 'password123',
          role: 'judge'
        });

      expect(res.statusCode).toBe(401);
    });

    test('Non-admin cannot register users', async () => {
      const users = await getAllUsers();
      const judgeUser = users.find(u => u.role === 'judge');

      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', authHeader(judgeUser.id, 'judge'))
        .send({
          email: 'test_judgereg@feosport.local',
          password: 'password123',
          role: 'judge'
        });

      expect(res.statusCode).toBe(403);
    });

    test('Admin-authorized registration creates new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', await adminAuth())
        .send({
          email: 'test_newuser@feosport.local',
          password: 'password123',
          role: 'judge'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe('test_newuser@feosport.local');
    });

    test('Duplicate email returns 409', async () => {
      await createTestUser('test_duplicate@feosport.local', 'password123', 'judge');

      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', await adminAuth())
        .send({
          email: 'test_duplicate@feosport.local',
          password: 'password123',
          role: 'judge'
        });

      expect(res.statusCode).toBe(409);
    });

    test('Short password returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', await adminAuth())
        .send({
          email: 'test_shortpwd@feosport.local',
          password: '123',
          role: 'judge'
        });

      expect(res.statusCode).toBe(400);
    });

    test('Invalid role returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', await adminAuth())
        .send({
          email: 'test_badsole@feosport.local',
          password: 'password123',
          role: 'invalid_role'
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('Authorization Header', () => {
    test('Request without auth header returns 401', async () => {
      const res = await request(app)
        .get('/api/admin/users');

      expect(res.statusCode).toBe(401);
    });

    test('Invalid token format returns 401', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Invalid token format');

      expect(res.statusCode).toBe(401);
    });

    test('Malformed JWT returns 401', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Bearer invalid.jwt.token');

      expect(res.statusCode).toBe(401);
    });

    test('Valid token grants access', async () => {
      const users = await getAllUsers();
      const adminUser = users.find(u => u.role === 'admin');

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', authHeader(adminUser.id, 'admin'));

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    test('Non-admin cannot access admin endpoints', async () => {
      const users = await getAllUsers();
      const judgeUser = users.find(u => u.role === 'judge');

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', authHeader(judgeUser.id, 'judge'));

      expect(res.statusCode).toBe(403);
    });

    test('Pilot cannot access judge endpoints', async () => {
      const users = await getAllUsers();
      const pilotUser = users.find(u => u.role === 'pilot');

      const res = await request(app)
        .get('/api/heats')
        .set('Authorization', authHeader(pilotUser.id, 'pilot'));

      expect(res.statusCode).toBe(403);
    });

    test('Chief judge can access admin endpoints', async () => {
      const users = await getAllUsers();
      const chiefJudgeUser = users.find(u => u.role === 'chief_judge');

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', authHeader(chiefJudgeUser.id, 'chief_judge'));

      expect(res.statusCode).toBe(200);
    });

    test('Admin can perform admin operations', async () => {
      const users = await getAllUsers();
      const adminUser = users.find(u => u.role === 'admin');

      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          email: 'test_newadmin@feosport.local',
          password: 'password123',
          role: 'judge'
        });

      expect([201, 200]).toContain(res.statusCode);
    });
  });

  describe('User Self-Protection', () => {
    test('Cannot change own role via PATCH', async () => {
      const users = await getAllUsers();
      const adminUser = users.find(u => u.role === 'admin');

      const res = await request(app)
        .patch(`/api/admin/users/${adminUser.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          role: 'pilot'
        });

      expect(res.statusCode).toBe(403);
    });

    test('Cannot deactivate self', async () => {
      const users = await getAllUsers();
      const adminUser = users.find(u => u.role === 'admin');

      const res = await request(app)
        .patch(`/api/admin/users/${adminUser.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          is_active: false
        });

      expect(res.statusCode).toBe(403);
    });

    test('Can change another user role', async () => {
      const users = await getAllUsers();
      const adminUser = users.find(u => u.role === 'admin');
      const judgeUser = users.find(u => u.role === 'judge');

      const res = await request(app)
        .patch(`/api/admin/users/${judgeUser.id}`)
        .set('Authorization', authHeader(adminUser.id, 'admin'))
        .send({
          role: 'chief_judge'
        });

      expect([200, 204]).toContain(res.statusCode);
    });
  });
});
