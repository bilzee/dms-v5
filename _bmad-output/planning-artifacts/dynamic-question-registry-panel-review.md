# Dynamic Question Registry — Party-Mode Panel Review (Session Record)

**Date:** 2026-09-12 · **Mode:** `bmad-party-mode` (orchestrated multi-agent discussion)
**Input reviewed:** `docs/plans/dynamic-question-registry-plan.md` (v1)
**Outcome:** 11 consensus amendments + 4 decisions routed to Bilnigma (D-1..D-4) + open questions resolved → folded into **plan v2** (same file, §9 Decision Log)

**Roster:** Winston 🏗️ Architect · Amelia 💻 Engineer · Sally 🎨 UX · John 📋 PM · Mary 📊 BA · Paige 📚 Tech Writer

**Ground rules (Bilnigma, verbatim):**
> "Do not involve me in the discussion, I will be observing from the balcony, I will have your recommendations at the end. Do not make recommendations simply to look important, I know you are all important agents, but I want only substantive recommendations."

> **Record fidelity:** agent positions below are condensed to their substance from the live session; Bilnigma's rulings are quoted verbatim. The authoritative folded-in decisions live in plan v2 §9.

---

## Round 1 — plan v1 under review

**Winston 🏗️ (Architect)** — Attacked the versioning and snapshot design as under-specified. v1 had a single version counter and a full-content snapshot; Winston showed this makes every cosmetic label edit look like a structural change and forces pointless re-freezes. Pushed for: (a) **dual counters** — `structureVersion` (key set / type / required / category membership) vs `contentVersion` (labels, helper text, severity) — so Tier A edits are cheap and visible; (b) **snapshot = structure only** (key, label, type, options, category, inverted, required, order, section — *not* severity), re-snapshotted on every successful submission; (c) demote stored `gapAnalysis` to a **cache** with severity as a live **derivation rule** — `analyzeGaps(snapshotStructure, liveRegistryRows)` — eliminating "Recalculate All" as a concept; (d) the freeze gate must be **per-question**, not global: v1's "no edits while any incident is ACTIVE" would effectively never open in near-continuous Nigerian disaster operations.

**Amelia 💻 (Engineer)** — Feasibility and sequencing. Warned the six typed Prisma tables are load-bearing across services, forms, and tests; dropping them mid-program breaks every prompt that follows. Required: (a) **compiler-driven sweep** — let `tsc` enumerate every reference, fix them all, no grep-and-hope; (b) a **temporary typed→answers converter** inside the assessment service so the legacy forms keep submitting green between the schema prompt and the dynamic-form prompt — every prompt must end with a working app; (c) the seed catalog must be **exact, no tildes** — approximated strings become the shipped product; (d) engine and validation logic split into pure, unit-testable modules under `src/lib/questions/`.

**Sally 🎨 (UX)** — The form is the product; a generic form will feel generic. Demanded the existing design language be captured as an explicit **Layout Contract** (zones, tinting, widget matrix, testid convention) before the dynamic form is built, not reverse-engineered from it. Flagged: (a) drafts saved by old forms must **auto-migrate with a plain-language receipt** — silent data loss is unacceptable to a field assessor mid-incident; (b) unanswered ≠ gap: per-question **gating** where untouched = neutral and the header counts confirmed gaps only; (c) the Situation Dashboard cannot grow with the registry — **severity × spread top-N ranking** with a hinted overflow chip, plus zero-gap suppression.

**John 📋 (PM)** — Risk and phasing. Accepted the architecture but pushed back on scope: (a) wanted notification severity inheritance **deferred** until after first real usage cycle ("we don't know what severity should route where") — this became D-4 and was overruled by Bilnigma; (b) insisted on the parity-baseline discipline (known pre-existing failures; the bar is *no new failures*, not zero); (c) demanded the freeze rule be operationalizable by a non-engineer admin — which shaped the 409-with-affected-count UX; (d) deferral list must be explicit, not silent.

## Round 2 — amendments stress-tested

**Winston 🏗️** — Sealed the **resolution ladder** for historical rows: live registry row (even if deactivated — the key still resolves) → snapshot severity → explicit `source: 'unmapped'` flag. Never rewrite history, never crash on orphans. Dual counters must bump **atomically inside the mutation transaction**, never after.

**Sally 🎨** — Validated the 7-zone Layout Contract against every existing form; insisted gap-first ordering be a **seed convention** (sort by category then order at runtime) so an admin can deliberately place a context question first; `data-testid = kebabCase(key)` preserves the Playwright selector convention.

**Mary 📊 (BA)** — Requirements hygiene: the seed catalog needs a **data dictionary appendix** defining each field's writing style (label = question, gapLabel = noun phrase, gapMeaning = declarative sentence, recommendation = imperative); **seed-vs-admin reconciliation policy** (seed is source of truth on fresh deploy; admin edits tracked via audit log + export, never silently overwritten by re-seeding — idempotent upserts keyed on `(assessmentType, key)`).

**Paige 📚 (Tech Writer)** — Documentation is a deliverable, not an afterthought: question **authoring guide** for the admin (a non-engineer writing questions post-launch is the whole point per D-1/D-3), API contract updates, schema reference.

## Final recommendations (consensus)

1. Snapshot is **structure-only**, re-snapshotted on every successful submission.
2. **Dual version counters** (`structureVersion`/`contentVersion`), bumped atomically in-transaction.
3. Stored `gapAnalysis`/priority are **caches**; severity follows a **derivation rule**; "Recalculate All" is deleted.
4. **Resolution ladder** for gap severity: live row → snapshot severity → `unmapped` flag.
5. **Per-question freeze**: structural edit to a key blocked (409 + affected ACTIVE-incident count) only if that key ∈ `questionSnapshot` of an assessment under an ACTIVE incident of that type. Adding questions and Tier A content edits always allowed; key rename = deactivate + create.
6. **Offline sync never rejects a completed assessment** — unknown keys persist verbatim; gaps computed on intersection. (The one genuine data-loss bug found in v1.)
7. **Draft auto-migration** with plain-language receipt + staleness banner that never blocks submission.
8. **Per-question gating** (untouched = neutral); header counts confirmed gaps only.
9. Dashboard: severity × spread **top-N** with hinted chip, **zero-gap suppression**, `gapRowsPerCategory` setting, "severities as of" stamp.
10. **Registry export endpoint** + data dictionary appendix + authoring guide.
11. **Seed-vs-admin reconciliation policy**: idempotent `(assessmentType, key)` upserts; audit log is the record of post-seed change.

**Routed to Bilnigma:** D-1 who edits questions post-launch (roles) · D-2 field-validation before editable? · D-3 post-launch language fixes · D-4 notification severity now or deferred?

**Open questions resolved by panel** (full list in plan v2 §9): dashboard growth → top-N + suppression; freeze semantics → per-question via snapshot membership; offline unknown keys → persist + intersect; seed reconciliation → upsert policy above.

## Plain-language translation (requested before ruling)

> Bilnigma: "I didn't read the details of the conversation you had so I need more explanation and implications of the decisions and questions in plain language, before I can respond."

Key points delivered: dual counters = cheap text fixes without touching structure; snapshot = each submitted assessment carries its own question-set description so history stays readable even after questions change; derivation rule = severity is recomputed from live config instead of frozen at submission (with a ladder so old rows never break); per-question freeze = you may add questions mid-incident and fix wording, but cannot change what an already-collected answer *means* while that incident is live; never-reject sync = a field officer's completed assessment is never thrown away because HQ changed the questions; D-4 = whether alert colors should come from the same question-severity pipeline as everything else.

## Bilnigma's rulings (verbatim)

> "D-1: There is a person who changes/edits questions after launch, and it should be part of admin's role only; coordinators are able to edit severity for the available questions in the existing severity configuration page. D-2: I don't need to validate before making it editable. Instead if it is editable, changes post validation will be swift; better spend the time now then be doing development work in the middle of an incident. D-3: The response is similar to D-2; if any ambiguity is found in the English, it can be swiftly corrected with editable questions. D-4: Severity of notifications should also be downstream of the questions, and I don't need to go through the first real usage cycle to know it is required. Looking at my responde in D1-3, what do you think? If you still think this should be deferred, explain to me better because I don't see your argument as strong, otherwise it should be implemented as long as the proposed plan makes sense and follows the bottom-up pattern."

## Orchestrator assessment of the rulings

- **D-1/D-2/D-3 — sound.** A single accountable editor (ADMIN) with severity-only delegation to coordinators matches the org model; building editable-first removes mid-incident engineering risk entirely.
- **D-4 — conceded; the panel was wrong to defer.** The deferral conflated two things: *severity-value passthrough* (a notification simply inherits the triggering object's severity — no field data needed, no rework, the derivation pipeline already exists) and *routing policy* (who gets which alert at which threshold — genuinely needs usage data). D-4 requires only the former. Honest boundary kept: system-health notifications (verification-overdue, population-cadence, sync errors) carry fixed severity per Appendix C because they have no triggering question.

## Outcome

All rulings folded into **plan v2** of `docs/plans/dynamic-question-registry-plan.md` (changelog at top; §2.8 notification inheritance; §2.6 in-transaction guards incl. QuestionAuditLog; §9 decision log). Implementation broken down into the bmad-quick-dev prompt series at `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/`.
