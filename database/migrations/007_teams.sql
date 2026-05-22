-- Migration 007: teams and team members for командные соревнования.
--
-- Source: разделы 1.3.4 (командные соревнования), 5.5.8.1.2 (состав команды:
-- 2-3 человека, пилот + механик + запасной), 2.4.11 (представитель команды).

CREATE TABLE IF NOT EXISTS teams (
    id            SERIAL       PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    region        VARCHAR(255),               -- субъект РФ
    representative_user_id INTEGER REFERENCES users(id), -- представитель (2.4.11)
    coach_user_id INTEGER REFERENCES users(id),         -- тренер (2.4.5)
    external_id   VARCHAR(100),               -- ID из CRM
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Уникальность external_id, когда задан.
CREATE UNIQUE INDEX IF NOT EXISTS teams_external_id_uq ON teams (external_id)
    WHERE external_id IS NOT NULL;

-- Состав команды.
-- Роли: 'pilot' (основной пилот), 'mechanic' (механик), 'reserve' (запасной).
-- is_captain: ровно один капитан в команде (см. 5.5.8.1.2 — капитан определяет
-- состав на гонку).
CREATE TABLE IF NOT EXISTS team_members (
    id          SERIAL       PRIMARY KEY,
    team_id     INTEGER      NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    pilot_id    INTEGER      NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
    role        VARCHAR(16)  NOT NULL,        -- 'pilot' | 'mechanic' | 'reserve'
    is_captain  BOOLEAN      NOT NULL DEFAULT false,
    joined_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE (team_id, pilot_id),
    CONSTRAINT team_members_role_chk
        CHECK (role IN ('pilot', 'mechanic', 'reserve'))
);

-- Капитан — не более одного на команду.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_captain_uq
    ON team_members (team_id) WHERE is_captain;

CREATE INDEX IF NOT EXISTS idx_team_members_team  ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_pilot ON team_members(pilot_id);

DROP TRIGGER IF EXISTS trg_teams_updated ON teams;
CREATE TRIGGER trg_teams_updated
    BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
