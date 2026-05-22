-- Migration 004: seed equipment reference data.
--
-- Sources:
--   * R-band frequencies — стандартная сетка R, упоминается в правилах 5.12.5
--     (видеопередатчик: рабочая частота 5,8 ГГц, набор каналов сетки R).
--   * Drone specs — таблица 10 правил.

-- ─── R-band 5.8 GHz channel grid (8 каналов) ─────────────────────────────────
INSERT INTO video_channels (code, band, frequency_mhz, sort_order) VALUES
    ('R1', 'R', 5658, 1),
    ('R2', 'R', 5695, 2),
    ('R3', 'R', 5732, 3),
    ('R4', 'R', 5769, 4),
    ('R5', 'R', 5806, 5),
    ('R6', 'R', 5843, 6),
    ('R7', 'R', 5880, 7),
    ('R8', 'R', 5917, 8)
ON CONFLICT (code) DO NOTHING;

-- ─── Drone specs (таблица 10) ────────────────────────────────────────────────
-- ─ Класс 75 мм ───────────────────────────────────────────────────────────────
INSERT INTO drone_specs (
    drone_class,
    max_takeoff_weight_g, min_takeoff_weight_g,
    min_diagonal_mm, max_diagonal_mm,
    motor_size_min, motor_size_max, motor_max_kv, max_propeller_inches,
    video_frequency_ghz, video_max_power_mw_min, video_max_power_mw_max,
    requires_prop_guards, requires_failsafe, min_leds,
    control_max_power_mw,
    battery_cells, battery_max_capacity_mah, battery_max_cell_voltage,
    team_min_batteries, team_charge_current_a,
    notes
) VALUES (
    '75mm',
    50, NULL,
    65, 75,
    NULL, NULL, NULL, NULL,
    5.8, 25, 25,
    true, true, NULL,
    50,
    1, 550, 4.35,
    4, 1.0,
    'Полётный контроллер Betaflight актуальной версии. Видеопередатчик: аналог или HDZero. Светодиоды равномерно на каждом луче (сверху и снизу), смена цвета ≤1 мин. Смена канала ≤1 мин.'
)
ON CONFLICT (drone_class) DO NOTHING;

-- ─ Класс 200 мм ──────────────────────────────────────────────────────────────
INSERT INTO drone_specs (
    drone_class,
    max_takeoff_weight_g, min_takeoff_weight_g,
    min_diagonal_mm, max_diagonal_mm,
    motor_size_min, motor_size_max, motor_max_kv, max_propeller_inches,
    video_frequency_ghz, video_max_power_mw_min, video_max_power_mw_max,
    requires_prop_guards, requires_failsafe, min_leds,
    control_max_power_mw,
    battery_cells, battery_max_capacity_mah, battery_max_cell_voltage,
    team_min_batteries, team_charge_current_a,
    notes
) VALUES (
    '200mm',
    650, NULL,
    180, 250,
    '2206', '2207.5', NULL, 5.1,
    5.8, 25, 200,
    false, true, 40,
    50,
    6, 1500, 4.20,
    4, 4.5,
    'Полётный контроллер Betaflight актуальной версии. Видеопередатчик: аналог или HDZero. Пропеллеры до 5,1 дюйма. Светодиоды (≥40 штук) равномерно на каждом луче (сверху и снизу), смена цвета ≤1 мин.'
)
ON CONFLICT (drone_class) DO NOTHING;

-- ─ Класс 330 мм ──────────────────────────────────────────────────────────────
INSERT INTO drone_specs (
    drone_class,
    max_takeoff_weight_g, min_takeoff_weight_g,
    min_diagonal_mm, max_diagonal_mm,
    motor_size_min, motor_size_max, motor_max_kv, max_propeller_inches,
    video_frequency_ghz, video_max_power_mw_min, video_max_power_mw_max,
    requires_prop_guards, requires_failsafe, min_leds,
    control_max_power_mw,
    battery_cells, battery_max_capacity_mah, battery_max_cell_voltage,
    team_min_batteries, team_charge_current_a,
    notes
) VALUES (
    '330mm',
    -- максимальной массы правила прямо не задают, оставляем NULL-эквивалент через большое значение;
    -- основное требование — минимум 850 г.
    99999, 850,
    300, 350,
    '2206', '2808', 2000, 7,
    5.8, 25, 200,
    false, true, 40,
    50,
    6, 2200, 4.20,
    4, 4.5,
    'Минимальная масса 850 г (с АКБ). Полётный контроллер Betaflight актуальной версии. Видеопередатчик: аналог или HDZero. Пропеллеры до 7 дюймов. Моторы до 2000 kv. Светодиоды (≥40 штук) равномерно на каждом луче (сверху и снизу), смена цвета ≤1 мин.'
)
ON CONFLICT (drone_class) DO NOTHING;
