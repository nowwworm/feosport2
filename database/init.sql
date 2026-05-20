-- Feosport2: Racing Competition DB Schema
-- PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ROLES ───────────────────────────────────────────────────────────────────
CREATE TABLE roles (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE  -- admin | chief_judge | judge | pilot
);

INSERT INTO roles (name) VALUES ('admin'), ('chief_judge'), ('judge'), ('pilot');

-- ─── USERS ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INTEGER      NOT NULL REFERENCES roles(id),
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── PILOTS ──────────────────────────────────────────────────────────────────
CREATE TABLE pilots (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    middle_name   VARCHAR(100),
    birth_date    DATE,
    team          VARCHAR(200),
    city          VARCHAR(100),
    video_channel VARCHAR(500),   -- YouTube/Rutube ссылка
    external_id   VARCHAR(100),   -- ID из CRM / Form Designer
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── COMPETITIONS ─────────────────────────────────────────────────────────────
CREATE TABLE competitions (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    location     VARCHAR(255),
    start_date   DATE,
    end_date     DATE,
    -- draft → registration → qualification → playoff → completed
    status       VARCHAR(50)  NOT NULL DEFAULT 'draft',
    playoff_size INTEGER      NOT NULL DEFAULT 16,
    created_by   INTEGER      REFERENCES users(id),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── HEATS (Вылеты / Заезды) ─────────────────────────────────────────────────
CREATE TABLE heats (
    id             SERIAL PRIMARY KEY,
    competition_id INTEGER      NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    -- qualification | round_of_16 | quarterfinal | semifinal | bronze_final | final
    round_type     VARCHAR(50)  NOT NULL,
    heat_number    INTEGER      NOT NULL,
    -- pending → active → locked
    status         VARCHAR(50)  NOT NULL DEFAULT 'pending',
    judge_id       INTEGER      REFERENCES users(id),
    scheduled_at   TIMESTAMPTZ,
    started_at     TIMESTAMPTZ,
    locked_at      TIMESTAMPTZ,
    locked_by      INTEGER      REFERENCES users(id),
    notes          TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(competition_id, round_type, heat_number)
);

-- ─── HEAT PARTICIPANTS ────────────────────────────────────────────────────────
CREATE TABLE heat_participants (
    id       SERIAL PRIMARY KEY,
    heat_id  INTEGER NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
    pilot_id INTEGER NOT NULL REFERENCES pilots(id),
    lane     INTEGER,              -- стартовая полоса / позиция
    UNIQUE(heat_id, pilot_id),
    UNIQUE(heat_id, lane)
);

-- ─── RESULTS ─────────────────────────────────────────────────────────────────
CREATE TABLE results (
    id               SERIAL PRIMARY KEY,
    heat_id          INTEGER        NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
    pilot_id         INTEGER        NOT NULL REFERENCES pilots(id),
    judge_id         INTEGER        NOT NULL REFERENCES users(id),
    time_seconds     NUMERIC(10,3),
    penalty_seconds  NUMERIC(10,3)  NOT NULL DEFAULT 0,
    dnf              BOOLEAN        NOT NULL DEFAULT false,  -- Did Not Finish
    dsq              BOOLEAN        NOT NULL DEFAULT false,  -- Disqualified
    -- Вычисляемое поле: хранится для репортинга и быстрых ORDER BY
    total_time       NUMERIC(10,3) GENERATED ALWAYS AS (
        CASE
            WHEN dsq OR dnf THEN NULL
            ELSE time_seconds + penalty_seconds
        END
    ) STORED,
    submitted_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE(heat_id, pilot_id)
);

-- ─── RESULT AUDIT LOG ─────────────────────────────────────────────────────────
-- Вся история правок — для разбора протестов и аналитики
CREATE TABLE result_audit_log (
    id                  SERIAL PRIMARY KEY,
    result_id           INTEGER        NOT NULL REFERENCES results(id),
    changed_by          INTEGER        NOT NULL REFERENCES users(id),
    old_time_seconds    NUMERIC(10,3),
    old_penalty_seconds NUMERIC(10,3),
    new_time_seconds    NUMERIC(10,3),
    new_penalty_seconds NUMERIC(10,3),
    change_reason       TEXT,
    changed_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─── PLAYOFF BRACKETS ────────────────────────────────────────────────────────
CREATE TABLE playoff_brackets (
    id             SERIAL PRIMARY KEY,
    competition_id INTEGER      NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    round_type     VARCHAR(50)  NOT NULL,
    bracket_slot   INTEGER      NOT NULL,  -- порядковый номер слота в сетке
    pilot_id       INTEGER      REFERENCES pilots(id),
    heat_id        INTEGER      REFERENCES heats(id),
    advanced       BOOLEAN,               -- прошёл в следующий раунд?
    seed           INTEGER,               -- посев из квалификации (1–16)
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(competition_id, round_type, bracket_slot)
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX pilots_external_id_uq ON pilots (external_id);
CREATE INDEX idx_heats_competition      ON heats(competition_id);
CREATE INDEX idx_heats_status           ON heats(status);
CREATE INDEX idx_results_heat           ON results(heat_id);
CREATE INDEX idx_results_pilot          ON results(pilot_id);
CREATE INDEX idx_result_audit_result    ON result_audit_log(result_id);
CREATE INDEX idx_playoff_competition    ON playoff_brackets(competition_id);
CREATE INDEX idx_heat_participants_heat ON heat_participants(heat_id);

-- ─── AUTO updated_at TRIGGER ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_competitions_updated
    BEFORE UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_heats_updated
    BEFORE UPDATE ON heats FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_results_updated
    BEFORE UPDATE ON results FOR EACH ROW EXECUTE FUNCTION set_updated_at();
