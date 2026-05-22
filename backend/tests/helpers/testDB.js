'use strict';

const pool = require('../../src/config/db');

/**
 * Clear all test data and reset sequences
 */
async function cleanupDB() {
  try {
    const tables = [
      'result_audit_log',
      'results',
      'heat_participants',
      'heats',
      'playoff_brackets',
      'competitions',
      'pilots',
      'users',
      'roles'
    ];

    for (const table of tables) {
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
  } catch (err) {
    console.error('[testDB] cleanup error:', err.message);
  }
}

/**
 * Seed baseline roles and users for testing
 */
async function seedBaselineData() {
  // Roles (if not exists)
  const roles = [
    { name: 'admin' },
    { name: 'chief_judge' },
    { name: 'judge' },
    { name: 'pilot' }
  ];

  for (const role of roles) {
    await pool.query(
      'INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [role.name]
    );
  }

  // Baseline users
  const bcrypt = require('bcryptjs');
  const baselineUsers = [
    { email: 'admin@feosport.local', password: 'password123', role: 'admin' },
    { email: 'chief@feosport.local', password: 'password123', role: 'chief_judge' },
    { email: 'judge@feosport.local', password: 'password123', role: 'judge' },
    { email: 'pilot@feosport.local', password: 'password123', role: 'pilot' }
  ];

  for (const user of baselineUsers) {
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [user.role]);
    if (roleResult.rows.length === 0) continue;

    const roleId = roleResult.rows[0].id;
    const passwordHash = await bcrypt.hash(user.password, 10);

    await pool.query(
      `INSERT INTO users (email, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET password_hash = $2, role_id = $3, is_active = $4`,
      [user.email, passwordHash, roleId, true]
    );
  }
}

/**
 * Create a test user with specified role
 */
async function createTestUser(email, password, role) {
  const bcrypt = require('bcryptjs');
  const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);

  if (roleResult.rows.length === 0) {
    throw new Error(`Role '${role}' not found`);
  }

  const roleId = roleResult.rows[0].id;
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role_id, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role_id`,
    [email, passwordHash, roleId, true]
  );

  return result.rows[0];
}

/**
 * Create a test competition
 */
async function createTestCompetition(name = 'Test Competition', status = 'draft') {
  const result = await pool.query(
    `INSERT INTO competitions (name, location, status, playoff_size)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, status`,
    [name, 'Test Location', status, 8]
  );

  return result.rows[0];
}

/**
 * Create test pilots
 */
async function createTestPilot(firstName, lastName, team = 'Test Team') {
  const result = await pool.query(
    `INSERT INTO pilots (first_name, last_name, team, city)
     VALUES ($1, $2, $3, $4)
     RETURNING id, first_name, last_name, team`,
    [firstName, lastName, team, 'Test City']
  );

  return result.rows[0];
}

/**
 * Create a test heat with participants
 */
async function createTestHeat(competitionId, judgeId, roundType = 'qualification', heatNumber = 1) {
  const result = await pool.query(
    `INSERT INTO heats (competition_id, judge_id, round_type, heat_number, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, competition_id, heat_number`,
    [competitionId, judgeId, roundType, heatNumber, 'pending']
  );

  return result.rows[0];
}

/**
 * Add participant to heat
 */
async function addHeatParticipant(heatId, pilotId, lane = 1) {
  const result = await pool.query(
    `INSERT INTO heat_participants (heat_id, pilot_id, lane)
     VALUES ($1, $2, $3)
     RETURNING heat_id, pilot_id, lane`,
    [heatId, pilotId, lane]
  );

  return result.rows[0];
}

/**
 * Get all users for test verification
 */
async function getAllUsers() {
  const result = await pool.query(
    `SELECT u.id, u.email, r.name as role, u.is_active
     FROM users u
     JOIN roles r ON u.role_id = r.id
     ORDER BY u.email`
  );
  return result.rows;
}

module.exports = {
  pool,
  cleanupDB,
  seedBaselineData,
  createTestUser,
  createTestCompetition,
  createTestPilot,
  createTestHeat,
  addHeatParticipant,
  getAllUsers
};
