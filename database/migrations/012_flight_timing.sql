-- Migration 012: phase 5 flight timing primitives.
--
-- Keeps the existing `heats` table for compatibility, while adding lap timing,
-- false-start records, and reflight requests needed by the drone racing rules.

ALTER TABLE heats ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE heats ADD COLUMN IF NOT EXISTS lap_limit INTEGER;
ALTER TABLE heats ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER;

ALTER TABLE heats DROP CONSTRAINT IF EXISTS heats_timing_limits_chk;
ALTER TABLE heats ADD CONSTRAINT heats_timing_limits_chk
    CHECK (
        (lap_limit IS NULL OR lap_limit > 0) AND
        (time_limit_seconds IS NULL OR time_limit_seconds > 0)
    );

CREATE TABLE IF NOT EXISTS laps (
    id            SERIAL       PRIMARY KEY,
    heat_id       INTEGER      NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
    pilot_id      INTEGER      NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
    lap_number    INTEGER      NOT NULL,
    duration_ms   INTEGER      NOT NULL,
    valid         BOOLEAN      NOT NULL DEFAULT true,
    recorded_by   INTEGER      REFERENCES users(id),
    completed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    notes         TEXT,

    UNIQUE (heat_id, pilot_id, lap_number),
    CONSTRAINT laps_number_chk CHECK (lap_number > 0),
    CONSTRAINT laps_duration_chk CHECK (duration_ms > 0)
);
CREATE INDEX IF NOT EXISTS idx_laps_heat ON laps(heat_id);
CREATE INDEX IF NOT EXISTS idx_laps_pilot ON laps(pilot_id);

CREATE TABLE IF NOT EXISTS falsestarts (
    id           SERIAL       PRIMARY KEY,
    heat_id      INTEGER      NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
    pilot_id     INTEGER      REFERENCES pilots(id) ON DELETE SET NULL,
    reason       TEXT,
    recorded_by  INTEGER      REFERENCES users(id),
    recorded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_falsestarts_heat ON falsestarts(heat_id);

CREATE TABLE IF NOT EXISTS reflights (
    id            SERIAL       PRIMARY KEY,
    heat_id       INTEGER      NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
    group_id      INTEGER      REFERENCES groups(id) ON DELETE SET NULL,
    reason        VARCHAR(64)  NOT NULL,
    requested_by  INTEGER      REFERENCES users(id),
    status        VARCHAR(16)  NOT NULL DEFAULT 'requested',
    notes         TEXT,
    requested_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    decided_at    TIMESTAMPTZ,

    CONSTRAINT reflights_status_chk
        CHECK (status IN ('requested', 'approved', 'rejected', 'completed'))
);
CREATE INDEX IF NOT EXISTS idx_reflights_heat ON reflights(heat_id);
CREATE INDEX IF NOT EXISTS idx_reflights_group ON reflights(group_id);
