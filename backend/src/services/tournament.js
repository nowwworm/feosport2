const pool = require('../config/db');

/**
 * Qualification leaderboard: best total_time per pilot across all locked
 * qualification heats, sorted ascending (lower = faster = better).
 * Pilots with only DNF/DSQ appear last (NULLS LAST).
 *
 * @param {number} competitionId
 * @returns {Promise<Array>}
 */
async function getQualificationLeaderboard(competitionId) {
  const { rows } = await pool.query(
    `SELECT
        p.id                                        AS pilot_id,
        p.first_name,
        p.last_name,
        p.team,
        COUNT(r.id)                                 AS runs,
        MIN(r.total_time)                           AS best_time,
        AVG(r.total_time)                           AS avg_time,
        SUM(CASE WHEN r.dnf THEN 1 ELSE 0 END)      AS dnf_count,
        SUM(CASE WHEN r.dsq THEN 1 ELSE 0 END)      AS dsq_count
     FROM pilots p
     JOIN heat_participants hp ON hp.pilot_id = p.id
     JOIN heats h              ON h.id = hp.heat_id
     LEFT JOIN results r       ON r.heat_id = h.id AND r.pilot_id = p.id
     WHERE h.competition_id = $1
       AND h.round_type      = 'qualification'
       AND h.status          = 'locked'
     GROUP BY p.id, p.first_name, p.last_name, p.team
     ORDER BY best_time ASC NULLS LAST`,
    [competitionId]
  );
  return rows;
}

/**
 * Generate playoff bracket for a competition.
 *
 * Preconditions:
 *   - Competition exists.
 *   - All qualification heats are locked.
 *
 * Steps:
 *   1. Fetch leaderboard → top N pilots (playoff_size from competitions row).
 *   2. Build standard single-elimination seeding: seed 1 vs N, 2 vs N-1, …
 *   3. Persist bracket into playoff_brackets (idempotent — deletes old rows first).
 *   4. Advance competition status to 'playoff'.
 *
 * @param {number} competitionId
 * @returns {Promise<{ competition_id, playoff_size, seeds, first_round }>}
 */
async function generatePlayoffs(competitionId) {
  const { rows: compRows } = await pool.query(
    'SELECT * FROM competitions WHERE id = $1',
    [competitionId]
  );
  if (!compRows.length) throw new Error(`Competition ${competitionId} not found`);
  const competition = compRows[0];

  const { rows: unlocked } = await pool.query(
    `SELECT id FROM heats
     WHERE competition_id = $1
       AND round_type = 'qualification'
       AND status != 'locked'`,
    [competitionId]
  );
  if (unlocked.length > 0) {
    throw new Error(
      `Cannot generate playoffs: ${unlocked.length} qualification heat(s) are not locked`
    );
  }

  const leaderboard  = await getQualificationLeaderboard(competitionId);
  const playoffSize  = competition.playoff_size || 16;
  const seeds = leaderboard.slice(0, playoffSize).map((row, idx) => ({
    seed:      idx + 1,
    pilot_id:  row.pilot_id,
    name:      `${row.first_name} ${row.last_name}`,
    team:      row.team,
    best_time: row.best_time,
  }));

  if (seeds.length < 2) {
    throw new Error('Not enough qualified pilots to generate playoffs');
  }

  const firstRound = buildFirstRoundMatchups(seeds);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM playoff_brackets WHERE competition_id = $1',
      [competitionId]
    );
    const roundLabel = `round_of_${seeds.length}`;
    for (const m of firstRound) {
      await client.query(
        `INSERT INTO playoff_brackets
           (competition_id, round_type, bracket_slot, pilot_id, seed)
         VALUES ($1, $2, $3, $4, $5)`,
        [competitionId, roundLabel, m.slot, m.pilot_id, m.seed]
      );
    }
    await client.query(
      "UPDATE competitions SET status = 'playoff', updated_at = NOW() WHERE id = $1",
      [competitionId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    competition_id: competitionId,
    playoff_size:   seeds.length,
    seeds,
    first_round:    firstRound,
  };
}

/**
 * Standard single-elimination seeding.
 * Seed 1 vs N, seed 2 vs N-1, etc.
 * Returns flat array of slot entries — two per matchup, one per pilot.
 *
 * @param {{ seed: number, pilot_id: number }[]} seeds
 * @returns {{ slot: number, pilot_id: number, seed: number, opponent_seed: number|null }[]}
 */
function buildFirstRoundMatchups(seeds) {
  const n = seeds.length;
  const matchups = [];

  for (let i = 0; i < Math.floor(n / 2); i++) {
    const top    = seeds[i];
    const bottom = seeds[n - 1 - i];
    matchups.push(
      { slot: i * 2 + 1, pilot_id: top.pilot_id,    seed: top.seed,    opponent_seed: bottom.seed },
      { slot: i * 2 + 2, pilot_id: bottom.pilot_id, seed: bottom.seed, opponent_seed: top.seed    }
    );
  }

  // Odd count: middle seed gets a bye
  if (n % 2 !== 0) {
    const mid = seeds[Math.floor(n / 2)];
    matchups.push({ slot: n, pilot_id: mid.pilot_id, seed: mid.seed, opponent_seed: null });
  }

  return matchups;
}

module.exports = { generatePlayoffs, getQualificationLeaderboard, buildFirstRoundMatchups };
