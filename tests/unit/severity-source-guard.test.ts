import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { SYSTEM_HEALTH_SEVERITY, resolveSeverityPriority } from '@/lib/severity-inheritance'

/**
 * DQR P6 (D-4) severity-source guard — the "cheapest honest mechanism"
 * (prompt-6 §4): a grep-style test asserting that no signal/notification
 * writer file contains a hardcoded severity literal.
 *
 * The sweep flags ANY line carrying a quoted severity literal
 * (CRITICAL/HIGH/MEDIUM/LOW/UNCLASSIFIED) in a writer file — property
 * bindings (`priority: 'HIGH'`), assignments (`const priority = 'HIGH'`),
 * ternary branches, and return statements alike — unless the line sources
 * its value from `resolveSeverityPriority` / `SYSTEM_HEALTH_SEVERITY` or is
 * one of the enumerated read-only/dead-code exceptions below.
 */

const WRITER_FILES = [
  'src/lib/services/action-signal.service.ts',
  'src/lib/services/notification.service.ts',
  'src/lib/services/leaderboard.service.ts',
  'src/lib/services/sync-processing.service.ts',
] as const

/**
 * Enumerated exceptions: full source lines allowed to carry a severity
 * literal. Each entry MUST be a read-only consumer (where-clause /
 * comparison / case-label / validation) or dead code slated for deletion —
 * never a live writer. A stale exception (line no longer present verbatim)
 * fails the last test and forces re-review.
 */
const READ_ONLY_EXCEPTIONS: ReadonlyArray<{ file: string; line: string }> = [
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "where: { ...where, resolvedAt: null, priority: 'CRITICAL' },",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "finalCritical = mappedSignals.filter(s => !s.resolvedAt && s.priority === 'CRITICAL').length;",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "case 'CRITICAL': return 4;",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "case 'HIGH': return 3;",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "case 'MEDIUM': return 2;",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "case 'LOW': return 1;",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "if (config.emailDigestEnabled && priority !== 'CRITICAL') return;",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "if (assessmentType === 'POPULATION') return 'CRITICAL';",
  },
  {
    file: 'src/lib/services/action-signal.service.ts',
    line: "if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(newPriority)) return;",
  },
  {
    file: 'src/lib/services/sync-processing.service.ts',
    line: "linkedAssessment && linkedAssessment.priority !== 'UNCLASSIFIED'",
  },
]

/** Files allowed to contain prisma/tx notification or actionSignal creation. */
const ALLOWED_CREATION_FILES = new Set([
  'src/lib/services/action-signal.service.ts',
  'src/lib/services/notification.service.ts',
])

const SEVERITY_LITERAL = /(['"])(CRITICAL|HIGH|MEDIUM|LOW|UNCLASSIFIED)\1/

const CREATION_SITE = /\.(notification|actionSignal)\.(create|createMany)\(/

function readSource(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8')
}

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

describe('DQR P6 severity-source guard', () => {
  test('SYSTEM_HEALTH_SEVERITY allowlist carries exactly the documented Appendix C boundary', () => {
    expect(SYSTEM_HEALTH_SEVERITY).toEqual({
      VERIFICATION_OVERDUE: 'CRITICAL',
      POPULATION_CADENCE: 'CRITICAL',
      SYNC_ERROR: 'CRITICAL',
      ACCOUNT_NOTICE: 'MEDIUM',
    })
  })

  test('resolveSeverityPriority passes valid severities through and floors everything else to MEDIUM', () => {
    expect(resolveSeverityPriority('CRITICAL')).toBe('CRITICAL')
    expect(resolveSeverityPriority('HIGH')).toBe('HIGH')
    expect(resolveSeverityPriority('MEDIUM')).toBe('MEDIUM')
    expect(resolveSeverityPriority('LOW')).toBe('LOW')
    // Absent / UNCLASSIFIED / invalid → MEDIUM (type sanitation floor)
    expect(resolveSeverityPriority(undefined)).toBe('MEDIUM')
    expect(resolveSeverityPriority(null)).toBe('MEDIUM')
    expect(resolveSeverityPriority('UNCLASSIFIED')).toBe('MEDIUM')
    expect(resolveSeverityPriority('banana')).toBe('MEDIUM')
    expect(resolveSeverityPriority('')).toBe('MEDIUM')
  })

  test('writer files contain zero hardcoded severity literals in any form outside the allowlist references and enumerated exceptions', () => {
    const violations: string[] = []

    for (const file of WRITER_FILES) {
      const lines = readSource(file).split(/\r?\n/)

      lines.forEach((line, index) => {
        if (!SEVERITY_LITERAL.test(line)) return
        if (line.includes('SYSTEM_HEALTH_SEVERITY') || line.includes('resolveSeverityPriority')) return

        const trimmed = line.trim()
        const isEnumeratedException = READ_ONLY_EXCEPTIONS.some(
          (exception) => exception.file === file && exception.line === trimmed
        )
        if (!isEnumeratedException) {
          violations.push(`${file}:${index + 1} → "${trimmed}"`)
        }
      })
    }

    expect(violations).toEqual([])
  })

  test('every enumerated exception still exists verbatim (stale exceptions force a re-review)', () => {
    for (const exception of READ_ONLY_EXCEPTIONS) {
      const source = readSource(exception.file)
      const occurrences = source
        .split(/\r?\n/)
        .filter((line) => line.trim() === exception.line).length
      expect(occurrences).toBe(1)
    }
  })

  test('notification/signal creation call sites exist only inside the allowed writer files', () => {
    const srcRoot = join(process.cwd(), 'src')
    const violations: string[] = []

    for (const absPath of listSourceFiles(srcRoot)) {
      const relPath = absPath.slice(process.cwd().length + 1).replace(/\\/g, '/')
      const lines = readFileSync(absPath, 'utf-8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (CREATION_SITE.test(line) && !ALLOWED_CREATION_FILES.has(relPath)) {
          violations.push(`${relPath}:${index + 1} → "${line.trim()}"`)
        }
      })
    }

    expect(violations).toEqual([])
  })
})
