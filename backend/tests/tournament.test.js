const { buildFirstRoundMatchups } = require('../src/services/tournament');

// ─── buildFirstRoundMatchups ──────────────────────────────────────────────────

const makeSeeds = (n) =>
  Array.from({ length: n }, (_, i) => ({ seed: i + 1, pilot_id: 100 + i, name: `Pilot ${i + 1}` }));

describe('buildFirstRoundMatchups', () => {
  describe('standard 16-seed bracket', () => {
    let matchups;
    beforeAll(() => { matchups = buildFirstRoundMatchups(makeSeeds(16)); });

    it('produces 16 slot entries (8 matchups × 2 slots)', () => {
      expect(matchups).toHaveLength(16);
    });

    it('pairs seed 1 vs seed 16', () => {
      const entry1  = matchups.find((m) => m.seed === 1);
      const entry16 = matchups.find((m) => m.seed === 16);
      expect(entry1.opponent_seed).toBe(16);
      expect(entry16.opponent_seed).toBe(1);
    });

    it('pairs seed 2 vs seed 15', () => {
      expect(matchups.find((m) => m.seed === 2).opponent_seed).toBe(15);
      expect(matchups.find((m) => m.seed === 15).opponent_seed).toBe(2);
    });

    it('slot numbers are unique and sequential starting from 1', () => {
      const slots = matchups.map((m) => m.slot).sort((a, b) => a - b);
      expect(slots[0]).toBe(1);
      expect(slots[slots.length - 1]).toBe(16);
      expect(new Set(slots).size).toBe(16);
    });

    it('every entry references a known pilot_id', () => {
      const ids = makeSeeds(16).map((s) => s.pilot_id);
      matchups.forEach((m) => expect(ids).toContain(m.pilot_id));
    });
  });

  describe('smaller 8-seed bracket', () => {
    it('produces 8 slot entries', () => {
      expect(buildFirstRoundMatchups(makeSeeds(8))).toHaveLength(8);
    });

    it('top seed faces bottom seed (1 vs 8)', () => {
      const m = buildFirstRoundMatchups(makeSeeds(8));
      expect(m.find((e) => e.seed === 1).opponent_seed).toBe(8);
    });
  });

  describe('odd number of seeds — bye handling', () => {
    it('middle seed receives a bye (opponent_seed = null)', () => {
      const m = buildFirstRoundMatchups(makeSeeds(7));
      const bye = m.find((e) => e.opponent_seed === null);
      expect(bye).toBeDefined();
      expect(bye.seed).toBe(4);
    });

    it('total entries = seed count', () => {
      expect(buildFirstRoundMatchups(makeSeeds(7))).toHaveLength(7);
    });
  });

  describe('edge cases', () => {
    it('returns [] for 0 seeds', () => {
      expect(buildFirstRoundMatchups([])).toHaveLength(0);
    });

    it('single seed gets bye', () => {
      const m = buildFirstRoundMatchups(makeSeeds(1));
      expect(m).toHaveLength(1);
      expect(m[0].opponent_seed).toBeNull();
    });

    it('2 seeds: seed 1 vs seed 2, no byes', () => {
      const m = buildFirstRoundMatchups(makeSeeds(2));
      expect(m).toHaveLength(2);
      expect(m.every((e) => e.opponent_seed !== null)).toBe(true);
    });
  });
});

// ─── generatePlayoffs — unit test with DB mock ────────────────────────────────

describe('generatePlayoffs (DB mocked)', () => {
  let tournament;
  let pool;

  beforeEach(() => {
    jest.resetModules();
    tournament = require('../src/services/tournament');
    pool = require('../src/config/db');
  });

  it('throws when competition is not found', async () => {
    pool.query = jest.fn().mockResolvedValueOnce({ rows: [] });
    await expect(tournament.generatePlayoffs(9999)).rejects.toThrow('not found');
  });

  it('throws when at least one qualification heat is not locked', async () => {
    pool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, playoff_size: 16 }] })  // competition
      .mockResolvedValueOnce({ rows: [{ id: 5 }] });                   // 1 unlocked heat
    await expect(tournament.generatePlayoffs(1)).rejects.toThrow('not locked');
  });
});
