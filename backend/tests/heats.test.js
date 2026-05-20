/**
 * Business-logic tests for heat locking and score submission rules.
 * Pure unit tests — no DB, no HTTP.
 */

// Inline the locked-guard logic (mirrors the checks in socket.js and routes/heats.js)
function canEditResult(heatStatus) {
  return heatStatus !== 'locked';
}

function canLockHeat(currentStatus) {
  return currentStatus !== 'locked';
}

function calcTotalTime({ time_seconds, penalty_seconds, dnf, dsq }) {
  if (dnf || dsq) return null;
  return time_seconds + (penalty_seconds ?? 0);
}

// ─── canEditResult ────────────────────────────────────────────────────────────

describe('canEditResult', () => {
  it('allows editing when heat is pending', () => {
    expect(canEditResult('pending')).toBe(true);
  });

  it('allows editing when heat is active', () => {
    expect(canEditResult('active')).toBe(true);
  });

  it('forbids editing when heat is locked — core business rule', () => {
    expect(canEditResult('locked')).toBe(false);
  });
});

// ─── canLockHeat ──────────────────────────────────────────────────────────────

describe('canLockHeat', () => {
  it('allows locking a pending heat', () => {
    expect(canLockHeat('pending')).toBe(true);
  });

  it('allows locking an active heat', () => {
    expect(canLockHeat('active')).toBe(true);
  });

  it('forbids locking an already-locked heat (idempotency guard)', () => {
    expect(canLockHeat('locked')).toBe(false);
  });
});

// ─── calcTotalTime ────────────────────────────────────────────────────────────

describe('calcTotalTime', () => {
  it('sums time and penalty for a clean run', () => {
    expect(calcTotalTime({ time_seconds: 40, penalty_seconds: 2.5, dnf: false, dsq: false }))
      .toBeCloseTo(42.5);
  });

  it('returns null for DNF', () => {
    expect(calcTotalTime({ time_seconds: 38, penalty_seconds: 0, dnf: true, dsq: false }))
      .toBeNull();
  });

  it('returns null for DSQ', () => {
    expect(calcTotalTime({ time_seconds: 38, penalty_seconds: 0, dnf: false, dsq: true }))
      .toBeNull();
  });

  it('treats missing penalty as 0', () => {
    expect(calcTotalTime({ time_seconds: 35.123, dnf: false, dsq: false }))
      .toBeCloseTo(35.123);
  });
});

// ─── Score submission workflow ────────────────────────────────────────────────

describe('Score submission workflow', () => {
  const store = [];

  function submitScore(heatStatus, payload) {
    if (!canEditResult(heatStatus)) throw new Error('Heat is locked');
    const entry = { ...payload, total_time: calcTotalTime(payload) };
    store.push(entry);
    return entry;
  }

  beforeEach(() => store.length = 0);

  it('stores result for an active heat', () => {
    const r = submitScore('active', { pilot_id: 1, time_seconds: 42.5, penalty_seconds: 0, dnf: false, dsq: false });
    expect(store).toHaveLength(1);
    expect(r.total_time).toBeCloseTo(42.5);
  });

  it('throws when attempting to submit to a locked heat', () => {
    expect(() =>
      submitScore('locked', { pilot_id: 2, time_seconds: 38.1, penalty_seconds: 0, dnf: false, dsq: false })
    ).toThrow('locked');
    expect(store).toHaveLength(0);
  });

  it('DNF result has null total_time and is stored', () => {
    const r = submitScore('active', { pilot_id: 3, time_seconds: null, penalty_seconds: 0, dnf: true, dsq: false });
    expect(r.total_time).toBeNull();
    expect(store).toHaveLength(1);
  });
});
