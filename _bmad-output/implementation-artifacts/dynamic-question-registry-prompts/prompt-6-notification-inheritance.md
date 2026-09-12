# Dynamic Question Registry — Prompt 6 of 9: Notification and Signal Severity Inheritance (D-4)

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 §2.8 is this prompt's authority) and verify every cited claim by reading the code (line numbers drift; enumerate notification/signal creation sites by search before editing).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now; (4) **D-4** notification/signal severity inherits from the triggering object; system-health notifications keep fixed severity (plan Appendix C); (5) severity is a **derivation rule**; stored results are caches; no "Recalculate All"; (6) **per-question freeze** (409 + affected count); adds/content edits always allowed; (7) offline sync **never rejects a completed assessment**; (8) `structureVersion`/`contentVersion` atomic; snapshots structure-only; (9) **baseline parity is the bar, not zero**.

## Sequence context

Prompt 6 of 9. Completed so far (confirm commits + spot-check before starting): **p1** schema/seed/data layer; **p2** registry service + admin API + tier gates; **p3** gap engine + recompute-on-edit; **p4** dynamic form, legacy forms deleted; **p5** never-reject sync + draft migration. If any of this is missing, stop and reconcile before proceeding.

**Why this prompt exists:** the panel wanted D-4 deferred; Bilnigma overruled — correctly. The deferral conflated *severity-value passthrough* (trivial: the value already exists on the triggering object) with *routing policy* (who hears about what — genuinely needs usage data, and is a Non-Goal per plan §0). This prompt implements only the passthrough, completing the bottom-up chain: question severity → assessment priority → incident → response plan/delivery → notification severity.

## Scope

### 1. `createNotification` passthrough

Locate the notification creation service/helper. Accept explicit severity (no default silently applied). Every assessment-domain event passes its source's severity, per plan §2.8: assessment created/updated/submitted/verified → `assessment.priority`; response-plan events → the plan's priority; commitment/delivery events → `incident.severity` (replacing the hardcoded `HIGH` found in the verification). Fix the offline-sync path the earlier audit flagged (response priority not carried) — it now rides the same rule.

### 2. Signals

Same inheritance: each signal's severity comes from the triggering object per §2.8; delete the hardcoded `HIGH`/`CRITICAL` constants at those creation sites (search `severity:` in signal/notification writers).

### 3. The fixed-severity boundary (Appendix C) — enumerated, not scattered

System-health notifications keep fixed severity because no question triggers them: verification-overdue → CRITICAL, population-cadence → CRITICAL, sync errors → error-level. Define these as one exported allowlist constant (e.g. `SYSTEM_HEALTH_SEVERITY`) so the boundary is auditable in a single place.

### 4. Tests

Jest: each event class inherits the right source severity; a test (or lint-style grep test — cheapest honest mechanism) asserting no notification/signal creation site outside the allowlist omits a severity source.

## Out of scope

Routing policy (who receives which severity — plan §0 Non-Goal with trigger), dashboard (p7), admin editor UI (p8), e2e/docs/holistic gate (p9).

## Verification gates

1. Parity vs baseline: lint 0 new; type-check/unit failure sets identical plus new suites.
2. New inheritance suite green.
3. Evidence log `dqr-p6-severity-sources.log`: every creation site listed with its severity source (object field or allowlist entry); zero hardcoded literals outside the allowlist.
4. Commit: `feat(questions): severity inheritance for notifications and signals (D-4)`.
