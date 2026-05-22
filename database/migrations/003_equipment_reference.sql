-- Migration 003: equipment reference tables (video channels + drone specs).
--
-- Source: Раздел 5.12, таблица 10 «Технические требования к оборудованию».

-- ─── VIDEO CHANNELS (5.8 GHz analog / HDZero R-band, 25 МВт) ─────────────────
-- Канал — критичный ресурс, требует управления конфликтами (см. правила 5.5.7.1).
CREATE TABLE IF NOT EXISTS video_channels (
    id         SERIAL      PRIMARY KEY,
    code       VARCHAR(16) NOT NULL UNIQUE, -- 'R1' .. 'R8'
    band       VARCHAR(16) NOT NULL,        -- 'R' (стандартная сетка из правил)
    frequency_mhz INTEGER  NOT NULL,        -- 5658..5917
    sort_order INTEGER     NOT NULL DEFAULT 0
);

-- ─── DRONE SPECS (Таблица 10) ────────────────────────────────────────────────
-- Технические требования к дрону по классам.
-- Один drone_spec на класс ('75mm' / '200mm' / '330mm').
-- Жёсткие пороги для проверки комиссией по допуску.
CREATE TABLE IF NOT EXISTS drone_specs (
    id                          SERIAL      PRIMARY KEY,
    drone_class                 VARCHAR(32) NOT NULL UNIQUE, -- '75mm' | '200mm' | '330mm'

    -- Габариты и масса
    max_takeoff_weight_g        INTEGER     NOT NULL,
    min_takeoff_weight_g        INTEGER,                      -- только для 330mm (≥850г)
    min_diagonal_mm             INTEGER     NOT NULL,
    max_diagonal_mm             INTEGER     NOT NULL,

    -- Моторы и пропеллеры
    motor_size_min              VARCHAR(16),                  -- '2206', '2207.5', '2808'
    motor_size_max              VARCHAR(16),
    motor_max_kv                INTEGER,                      -- 2000 для 330mm
    max_propeller_inches        NUMERIC(4,2),                 -- 5.1 / 7

    -- Видеопередатчик
    video_frequency_ghz         NUMERIC(3,1) NOT NULL DEFAULT 5.8,
    video_max_power_mw_min      INTEGER     NOT NULL,         -- 25
    video_max_power_mw_max      INTEGER,                      -- до 200 для 200/330

    -- Защита и обязательные элементы
    requires_prop_guards        BOOLEAN     NOT NULL DEFAULT false,
    requires_failsafe           BOOLEAN     NOT NULL DEFAULT true,
    min_leds                    INTEGER,                      -- 40 для 200/330

    -- Аппаратура управления
    control_max_power_mw        INTEGER     NOT NULL DEFAULT 50,

    -- Аккумулятор
    battery_cells               INTEGER     NOT NULL,         -- 1S / 6S
    battery_max_capacity_mah    INTEGER     NOT NULL,
    battery_max_cell_voltage    NUMERIC(4,2) NOT NULL,        -- 4.35 / 4.20
    -- Командные доп. требования (запасные АКБ)
    team_min_batteries          INTEGER,                      -- 4
    team_charge_current_a       NUMERIC(4,2),                 -- 1.0 / 4.5

    notes                       TEXT
);
