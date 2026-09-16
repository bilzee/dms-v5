import type { SignalPriority } from '@/types/action-signal';

/**
 * DQR P6 (D-4) — notification & signal severity inheritance.
 *
 * Plan §2.8: every situational signal/notification inherits the severity of
 * its triggering object (assessment → response → commitment → incident). The
 * ONLY writers allowed to carry a fixed severity value are the system-health
 * events below — they have no question-derived severity to inherit (plan
 * Appendix C). This constant is the single auditable boundary; writer files
 * must reference it instead of inlining literals (tests/unit/severity-source-
 * guard.test.ts enforces that).
 *
 * SYNC_ERROR is reserved: no sync-error notification writer exists today
 * (only failed SyncResult rows + SyncConflict.coordinatorNotified flags) —
 * it is declared here so the boundary is auditable if one is added.
 */
export const SYSTEM_HEALTH_SEVERITY = {
  /** Submissions awaiting verification for > 48h (action-signal.service.ts). */
  VERIFICATION_OVERDUE: 'CRITICAL',
  /** Population assessment cadence breach (evaluatePopulationCadence). */
  POPULATION_CADENCE: 'CRITICAL',
  /** Reserved for a future sync-error notification writer. */
  SYNC_ERROR: 'CRITICAL',
  /** Gamification/leaderboard account notices (Appendix C "account/system notices"). */
  ACCOUNT_NOTICE: 'MEDIUM',
} as const satisfies Record<string, SignalPriority>;

const VALID_PRIORITIES: ReadonlySet<string> = new Set([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
]);

/**
 * Type sanitation for the severity chain — never a replacement for an
 * available source. Callers must first pass the triggering object's own
 * severity/priority field; only absent, UNCLASSIFIED, or invalid values
 * fall through to the MEDIUM floor (mirroring P5's "never silently LOW"
 * ladder).
 */
export function resolveSeverityPriority(value?: string | null): SignalPriority {
  if (typeof value === 'string' && VALID_PRIORITIES.has(value)) {
    return value as SignalPriority;
  }
  return 'MEDIUM';
}
