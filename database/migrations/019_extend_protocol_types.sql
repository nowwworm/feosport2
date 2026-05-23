-- Migration 019: extend official protocol catalogue to cover Phase 10 debt.
--
-- Adds the remaining printable protocol kinds from Appendices 4-6:
-- team relay course, simulator qualification/course, tiebreak duel, and the
-- event report. Existing rows remain valid.

ALTER TABLE protocols DROP CONSTRAINT IF EXISTS protocols_type_chk;
ALTER TABLE protocols ADD CONSTRAINT protocols_type_chk
    CHECK (protocol_type IN (
        'qualification',
        'stage_results',
        'final',
        'team_relay',
        'simulator_qualification',
        'simulator_results',
        'final_standings',
        'team_summary',
        'tiebreak',
        'event_report'
    ));
