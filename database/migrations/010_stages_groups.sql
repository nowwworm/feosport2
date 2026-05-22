-- Migration 010: stages, groups, group participants.
--
-- Source:
--   §1.4   — этапы (квалификация → 1/8 → 1/4 → 1/2 → финал)
--   §1.4.3 — playoff_size 16 / 32 → разные стартовые этапы
--   §1.4.4 — система 4/8 (только симулятор)
--   Таблицы 3, 4, 6 — распределение спортсменов по группам
--
-- Иерархия:
--   competition → stage → group → group_participants
--                      └→ heats (вылеты группы; FK group_id)

CREATE TABLE IF NOT EXISTS stages (
    id              SERIAL       PRIMARY KEY,
    competition_id  INTEGER      NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    -- Значения: 'qualification' | 'round_of_16' (1/8) | 'quarterfinal' (1/4) |
    --           'semifinal' (1/2) | 'final'
    stage_type      VARCHAR(32)  NOT NULL,
    -- Порядковый номер этапа в соревновании (1=qual, 2=R16, …).
    ordinal         INTEGER      NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE (competition_id, stage_type),
    UNIQUE (competition_id, ordinal),
    CONSTRAINT stages_type_chk
        CHECK (stage_type IN ('qualification', 'round_of_16', 'quarterfinal', 'semifinal', 'final')),
    CONSTRAINT stages_status_chk
        CHECK (status IN ('pending', 'active', 'completed'))
);
CREATE INDEX IF NOT EXISTS idx_stages_competition ON stages(competition_id);
DROP TRIGGER IF EXISTS trg_stages_updated ON stages;
CREATE TRIGGER trg_stages_updated
    BEFORE UPDATE ON stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── GROUPS ──────────────────────────────────────────────────────────────────
-- Группы внутри этапа. Размер группы = 4 или 8 (зависит от race_system).
CREATE TABLE IF NOT EXISTS groups (
    id            SERIAL       PRIMARY KEY,
    stage_id      INTEGER      NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    group_number  INTEGER      NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE (stage_id, group_number)
);
CREATE INDEX IF NOT EXISTS idx_groups_stage ON groups(stage_id);

-- ─── GROUP PARTICIPANTS ──────────────────────────────────────────────────────
-- Стартовая раскладка группы. Личное участие → pilot_id, командное → team_id.
-- `slot` — стартовая позиция (1..N).
-- `seed` — посев (для финального этапа — порядок по итогам предыдущего).
-- `finish_place`, `points` — обновляются после завершения этапа.
CREATE TABLE IF NOT EXISTS group_participants (
    id            SERIAL       PRIMARY KEY,
    group_id      INTEGER      NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    pilot_id      INTEGER      REFERENCES pilots(id) ON DELETE CASCADE,
    team_id       INTEGER      REFERENCES teams(id)  ON DELETE CASCADE,
    slot          INTEGER      NOT NULL,
    seed          INTEGER,
    finish_place  INTEGER,
    points        INTEGER,

    UNIQUE (group_id, slot),
    UNIQUE (group_id, pilot_id),
    UNIQUE (group_id, team_id),
    CONSTRAINT gp_subject_chk
        CHECK ((pilot_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_gp_group ON group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_gp_pilot ON group_participants(pilot_id);
CREATE INDEX IF NOT EXISTS idx_gp_team  ON group_participants(team_id);

-- ─── HEATS link to group ─────────────────────────────────────────────────────
-- Привязка вылетов к группе (опционально для совместимости со старым кодом).
ALTER TABLE heats ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_heats_group ON heats(group_id);
