-- Migration 009: drones registration + equipment inspections.
--
-- Source:
--   §2.2.5  — комиссия по допуску проверяет дроны на соответствие требованиям
--   §5.3.2  — функции главного судьи комиссии: проверка дронов
--   §5.12   — технические требования к оборудованию
--   §5.5.7.1.1 / §5.5.8.1.4 — у пилота не менее 2 дронов, у команды не менее 3
--   §6.3.6  — функции судьи технического контроля

-- ─── DRONES ──────────────────────────────────────────────────────────────────
-- Зарегистрированный экземпляр дрона. Принадлежит пилоту или команде.
CREATE TABLE IF NOT EXISTS drones (
    id              SERIAL       PRIMARY KEY,
    pilot_id        INTEGER      REFERENCES pilots(id) ON DELETE CASCADE,
    team_id         INTEGER      REFERENCES teams(id)  ON DELETE CASCADE,

    -- Класс — должен совпадать с одним из drone_specs.drone_class.
    drone_class     VARCHAR(32)  NOT NULL,
    name            VARCHAR(100),                  -- nickname/маркировка
    serial_number   VARCHAR(100),

    -- Измеренные характеристики (заполняются при заявке/регистрации,
    -- проверяются судьёй технического контроля).
    weight_g                  INTEGER,
    diagonal_mm               INTEGER,
    motor_size                VARCHAR(16),
    motor_kv                  INTEGER,
    propeller_inches          NUMERIC(4,2),
    video_channel_id          INTEGER REFERENCES video_channels(id),
    video_power_mw            INTEGER,
    battery_cells             INTEGER,
    battery_capacity_mah      INTEGER,
    battery_max_cell_voltage  NUMERIC(4,2),
    leds_count                INTEGER,
    has_prop_guards           BOOLEAN,
    has_failsafe              BOOLEAN,
    control_power_mw          INTEGER,

    -- Состояние
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Дрон принадлежит ровно одному владельцу: пилоту ИЛИ команде.
    CONSTRAINT drones_owner_chk
        CHECK ((pilot_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1),
    CONSTRAINT drones_class_chk
        CHECK (drone_class IN ('75mm', '200mm', '330mm'))
);

CREATE INDEX IF NOT EXISTS idx_drones_pilot ON drones(pilot_id);
CREATE INDEX IF NOT EXISTS idx_drones_team  ON drones(team_id);
CREATE INDEX IF NOT EXISTS idx_drones_class ON drones(drone_class);

DROP TRIGGER IF EXISTS trg_drones_updated ON drones;
CREATE TRIGGER trg_drones_updated
    BEFORE UPDATE ON drones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── EQUIPMENT INSPECTIONS ───────────────────────────────────────────────────
-- Запись об осмотре дрона судьёй технического контроля.
-- На каждый дрон может быть несколько записей (после исправления нарушений).
-- Актуальный статус дрона = последний по `inspected_at` для данного дрона.
CREATE TABLE IF NOT EXISTS equipment_inspections (
    id              SERIAL       PRIMARY KEY,
    drone_id        INTEGER      NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
    application_id  INTEGER      REFERENCES applications(id) ON DELETE SET NULL,
    inspected_by    INTEGER      NOT NULL REFERENCES users(id),
    -- 'passed' | 'rejected' | 'conditional' (исправляется механиком)
    result          VARCHAR(16)  NOT NULL,
    -- JSON-список нарушений: [{rule, expected, actual, severity}]
    violations      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    notes           TEXT,
    inspected_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT inspections_result_chk
        CHECK (result IN ('passed', 'rejected', 'conditional'))
);

CREATE INDEX IF NOT EXISTS idx_inspections_drone       ON equipment_inspections(drone_id);
CREATE INDEX IF NOT EXISTS idx_inspections_application ON equipment_inspections(application_id);
CREATE INDEX IF NOT EXISTS idx_inspections_inspected_at ON equipment_inspections(inspected_at DESC);
