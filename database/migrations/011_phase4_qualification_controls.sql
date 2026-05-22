-- Migration 011: phase 4 qualification controls and no-show replacement data.
--
-- Supports two qualification systems:
--   1. laps_time  — complete N laps as fast as possible.
--   2. max_laps   — complete as many laps as possible within a time limit.
--
-- Qualification results are intentionally stored on group_participants for now:
-- Phase 5 will add lap-level timing, while Phase 4 only needs stage ranking.

ALTER TABLE stages ADD COLUMN IF NOT EXISTS qualification_mode VARCHAR(32);
ALTER TABLE stages ADD COLUMN IF NOT EXISTS target_laps INTEGER;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER;

ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_qualification_mode_chk;
ALTER TABLE stages ADD CONSTRAINT stages_qualification_mode_chk
    CHECK (
        qualification_mode IS NULL OR
        qualification_mode IN ('laps_time', 'max_laps')
    );

ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_qualification_shape_chk;
ALTER TABLE stages ADD CONSTRAINT stages_qualification_shape_chk
    CHECK (
        stage_type <> 'qualification' OR
        qualification_mode IS NULL OR
        (
            qualification_mode = 'laps_time' AND
            target_laps IS NOT NULL AND target_laps > 0
        ) OR
        (
            qualification_mode = 'max_laps' AND
            time_limit_seconds IS NOT NULL AND time_limit_seconds > 0
        )
    );

ALTER TABLE group_participants ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(16) NOT NULL DEFAULT 'present';
ALTER TABLE group_participants ADD COLUMN IF NOT EXISTS replaced_pilot_id INTEGER REFERENCES pilots(id) ON DELETE SET NULL;
ALTER TABLE group_participants ADD COLUMN IF NOT EXISTS replaced_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE group_participants ADD COLUMN IF NOT EXISTS replacement_reason TEXT;
ALTER TABLE group_participants ADD COLUMN IF NOT EXISTS qualification_total_laps INTEGER;
ALTER TABLE group_participants ADD COLUMN IF NOT EXISTS qualification_total_time_ms INTEGER;
ALTER TABLE group_participants ADD COLUMN IF NOT EXISTS qualification_best_lap_ms INTEGER;

ALTER TABLE group_participants DROP CONSTRAINT IF EXISTS gp_attendance_status_chk;
ALTER TABLE group_participants ADD CONSTRAINT gp_attendance_status_chk
    CHECK (attendance_status IN ('present', 'no_show', 'replaced'));

ALTER TABLE group_participants DROP CONSTRAINT IF EXISTS gp_qualification_metrics_chk;
ALTER TABLE group_participants ADD CONSTRAINT gp_qualification_metrics_chk
    CHECK (
        (qualification_total_laps IS NULL OR qualification_total_laps >= 0) AND
        (qualification_total_time_ms IS NULL OR qualification_total_time_ms >= 0) AND
        (qualification_best_lap_ms IS NULL OR qualification_best_lap_ms >= 0)
    );
