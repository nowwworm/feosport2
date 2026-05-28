'use strict';

// Reference data endpoints (read-only catalogues seeded from Минспорт rules).
// Used by all roles — discipline pickers, age-group filters, channel managers, etc.

const router = require('express').Router();
const pool   = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/disciplines', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name_ru, category, drone_class, is_team, sort_order
         FROM disciplines
        ORDER BY sort_order, id`
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/race-systems', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name_ru, group_size, advance_count
         FROM race_systems
        ORDER BY group_size`
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/race-formats', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name_ru FROM race_formats ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/age-groups', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name_ru, min_age, max_age, age_check, notes
         FROM age_groups
        ORDER BY min_age`
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/video-channels', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, band, frequency_mhz, sort_order
         FROM video_channels
        ORDER BY sort_order, frequency_mhz`
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/drone-specs', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
         FROM drone_specs
        ORDER BY
          CASE drone_class
            WHEN '75mm'  THEN 1
            WHEN '200mm' THEN 2
            WHEN '330mm' THEN 3
            ELSE 99
          END`
    );
    res.json(rows);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

router.get('/drone-specs/:droneClass', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM drone_specs WHERE drone_class = $1`,
      [req.params.droneClass]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    (console.error(err), res.status(500).json({ error: 'Internal Server Error' }));
  }
});

module.exports = router;
