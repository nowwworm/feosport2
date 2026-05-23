-- Migration 014: simulator support — connection records and competition config.
--
-- §5.5.9 / §1.4.4 — гонки на симуляторе:
--   * все участники одновременно дисконнектнулись → переигровка ГСК.
--   * один пилот многократно отвалился → техническое поражение.
--   * пороги (таймаут ожидания, число попыток) задаются Положением.

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS simulator_software_name TEXT;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS simulator_version       TEXT;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS simulator_settings_json JSONB;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS simulator_max_attempts  INTEGER;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS simulator_wait_timeout_seconds INTEGER;

ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_sim_thresholds_chk;
ALTER TABLE competitions ADD CONSTRAINT competitions_sim_thresholds_chk
    CHECK (
        (simulator_max_attempts IS NULL OR simulator_max_attempts > 0) AND
        (simulator_wait_timeout_seconds IS NULL OR simulator_wait_timeout_seconds > 0)
    );

CREATE TABLE IF NOT EXISTS disconnects (
    id            SERIAL       PRIMARY KEY,
    heat_id       INTEGER      NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
    pilot_id      INTEGER      REFERENCES pilots(id) ON DELETE SET NULL,
    scope         VARCHAR(16)  NOT NULL,        -- 'single' | 'all'
    reason        TEXT,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    recorded_by   INTEGER      REFERENCES users(id),
    notes         TEXT,

    CONSTRAINT disconnects_scope_chk CHECK (scope IN ('single', 'all'))
);
CREATE INDEX IF NOT EXISTS idx_disconnects_heat  ON disconnects(heat_id);
CREATE INDEX IF NOT EXISTS idx_disconnects_pilot ON disconnects(pilot_id);
