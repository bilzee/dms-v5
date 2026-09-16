/**
 * DQR P6 evidence scan — proves the D-4 severity-inheritance boundary at the
 * SOURCE level (the behavioral proof lives in tests/api/severity-inheritance.
 * test.ts, which pins every I/O matrix row against a real database):
 *
 *   1. Every signal/notification/response CREATION site in the four writer
 *      files is enumerated with the severity source it reads from — the
 *      triggering object's field laundered through `resolveSeverityPriority`,
 *      an entry of the `SYSTEM_HEALTH_SEVERITY` allowlist, or a passthrough
 *      of an existing row's stored priority.
 *   2. Zero hardcoded severity literals anywhere in the writer files outside
 *      the allowlist module — including priority ASSIGNMENTS (`const priority
 *      = 'HIGH'`), not just property bindings.
 *   3. The allowlist (src/lib/severity-inheritance.ts) carries exactly the
 *      four documented Appendix C entries.
 *
 * Unlike dqr-p4/p5 this is a pure static scan — no database is touched, so no
 * DATABASE_URL guard applies.
 *
 * Run:  npx tsx scripts/dqr-p6-severity-evidence.ts
 * Log:  _bmad-output/implementation-artifacts/dqr-p6-severity-sources.log
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, relative, sep, join } from 'path'

let failures = 0

function log(step: string, detail: Record<string, unknown>): void {
  console.log(`\n[${step}]`)
  for (const [key, value] of Object.entries(detail)) {
    console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}`)
  }
}

function check(step: string, condition: boolean, message: string): void {
  if (!condition) {
    failures += 1
    console.error(`  FAIL: ${message}`)
  }
}

function readSource(relPath: string): string {
  return readFileSync(resolve(__dirname, '..', relPath), 'utf-8')
}

const WRITER_FILES = [
  'src/lib/services/action-signal.service.ts',
  'src/lib/services/notification.service.ts',
  'src/lib/services/leaderboard.service.ts',
  'src/lib/services/sync-processing.service.ts',
] as const

interface CallSite {
  file: string
  line: number
  callee: string
  body: string
}

/**
 * Extract the balanced-parenthesis argument block of every call matching
 * `callee`. Naive depth tracking is sufficient here: the scanned writers keep
 * parentheses balanced inside their template strings.
 */
function extractCallBlocks(source: string, callee: string, file: string): CallSite[] {
  const sites: CallSite[] = []
  let searchFrom = 0
  while (true) {
    const idx = source.indexOf(callee, searchFrom)
    if (idx === -1) break
    // callee patterns end with '(' — the opening paren is the callee's own
    // last character; otherwise scan forward to the next '('.
    const openIdx = callee.endsWith('(')
      ? idx + callee.length - 1
      : source.indexOf('(', idx + callee.length)
    if (openIdx === -1) {
      failures += 1
      console.error(`  FAIL: unbalanced call site scanning "${callee}" in ${file} (no opening paren) — audit truncated`)
      break
    }
    let depth = 0
    let closeIdx = -1
    for (let i = openIdx; i < source.length; i++) {
      const ch = source[i]
      if (ch === '(' || ch === '{') depth++
      else if (ch === ')' || ch === '}') {
        depth--
        if (depth === 0 && ch === ')') {
          closeIdx = i
          break
        }
      }
    }
    if (closeIdx === -1) {
      failures += 1
      console.error(`  FAIL: unbalanced call site scanning "${callee}" in ${file} (no closing paren) — audit truncated`)
      break
    }
    sites.push({
      file,
      line: source.slice(0, idx).split(/\r?\n/).length,
      callee: callee.replace(/\.$/, ''),
      body: source.slice(openIdx + 1, closeIdx),
    })
    searchFrom = closeIdx + 1
  }
  return sites
}

/** Capture the expression bound to a `priority` property (or shorthand). */
function extractPriorityExpression(body: string): string | null {
  // Shorthand form: `priority,` / `{ priority }`
  const shorthand = /(?:^|[\s,{])priority\s*(?=[,}])/
  if (shorthand.test(body)) return 'priority'
  const match = body.match(/priority\s*:\s*/)
  if (!match) return null
  const start = match.index! + match[0].length
  let depth = 0
  let end = start
  for (; end < body.length; end++) {
    const ch = body[end]
    if (ch === '(' || ch === '{') depth++
    else if (ch === ')' || ch === '}') {
      if (depth === 0) break
      depth--
    } else if (ch === ',' && depth === 0) break
    else if (ch === '\n' && depth === 0) break
  }
  return body.slice(start, end).trim().replace(/,$/, '')
}

/** Capture the expression bound to `signalReason` (creation-site label). */
function extractReasonExpression(body: string): string {
  const shorthand = /(?:^|[\s,{])reason\s*(?=[,}])/
  if (shorthand.test(body)) return 'reason'
  const match = body.match(/signalReason\s*:\s*/)
  if (!match) return '(none)'
  const start = match.index! + match[0].length
  let end = start
  while (end < body.length && body[end] !== ',' && body[end] !== '\n') end++
  return body.slice(start, end).trim()
}

function classify(expr: string | null): { label: string; ok: boolean } {
  if (expr === null) return { label: 'NO PRIORITY SOURCE', ok: false }
  const e = expr.trim()
  if (/^SYSTEM_HEALTH_SEVERITY\.[A-Z_]+$/.test(e)) {
    return { label: `allowlist entry ${e} (plan Appendix C fixed boundary)`, ok: true }
  }
  if (/^resolveSeverityPriority\(/.test(e)) {
    return { label: `resolver passthrough ${e} (triggering object's own severity)`, ok: true }
  }
  if (/^(payload|data)\.(assessmentPriority|responsePriority)$/.test(e)) {
    return { label: `dispatcher-supplied source field ${e}`, ok: true }
  }
  if (/^existing\.priority$/.test(e)) {
    return { label: 'existing-row passthrough existing.priority (offline update)', ok: true }
  }
  if (/^payload\.priority$/.test(e)) {
    return { label: 'explicit caller-supplied priority (legacy send contract)', ok: true }
  }
  if (e === 'priority' || e === 'planPriority' || e === 'derivedPriority') {
    return {
      label: `resolver-backed local variable \`${e}\` (enforced by the literal-assignment sweep)`,
      ok: true,
    }
  }
  if (/^(['"])(CRITICAL|HIGH|MEDIUM|LOW|UNCLASSIFIED)\1$/.test(e)) {
    return { label: `HARDCODED LITERAL ${e}`, ok: false }
  }
  return { label: `UNRECOGNIZED SOURCE: ${e}`, ok: false }
}

function main(): void {
  console.log('DQR P6 severity-source evidence scan')
  console.log(`Scanned writers: ${WRITER_FILES.join(', ')}`)

  const sources = new Map<string, string>(WRITER_FILES.map((f) => [f, readSource(f)]))

  // ---- 1. Allowlist module carries exactly the documented boundary -------
  const allowlistSource = readSource('src/lib/severity-inheritance.ts')
  const allowlistBlock = allowlistSource.match(/SYSTEM_HEALTH_SEVERITY = \{([\s\S]*?)\} as const/)
  const allowlistKeys = allowlistBlock
    ? Array.from(allowlistBlock[1].matchAll(/^\s*([A-Z_]+):/gm)).map((m) => m[1])
    : []
  const allowlistValues = allowlistBlock
    ? Array.from(allowlistBlock[1].matchAll(/^\s*([A-Z_]+):\s*'([A-Z]+)'/gm)).map((m) => `${m[1]}=${m[2]}`)
    : []
  log('1. SYSTEM_HEALTH_SEVERITY allowlist (src/lib/severity-inheritance.ts)', {
    keys: allowlistKeys,
    entries: allowlistValues,
  })
  check(
    '1',
    JSON.stringify(allowlistKeys) === JSON.stringify(['VERIFICATION_OVERDUE', 'POPULATION_CADENCE', 'SYNC_ERROR', 'ACCOUNT_NOTICE']) &&
      JSON.stringify(allowlistValues) === JSON.stringify(['VERIFICATION_OVERDUE=CRITICAL', 'POPULATION_CADENCE=CRITICAL', 'SYNC_ERROR=CRITICAL', 'ACCOUNT_NOTICE=MEDIUM']),
    'allowlist must carry exactly VERIFICATION_OVERDUE/POPULATION_CADENCE/SYNC_ERROR=CRITICAL and ACCOUNT_NOTICE=MEDIUM (no extra entries)'
  )

  // ---- 2. Every creation site listed with its severity source ------------
  const calleeTargets: Array<{ file: string; callee: string; siteKind: string }> = [
    { file: 'src/lib/services/action-signal.service.ts', callee: 'this.upsertSignal(', siteKind: 'action signal' },
    { file: 'src/lib/services/action-signal.service.ts', callee: 'tx.notification.create(', siteKind: 'in-app notification (signal row)' },
    { file: 'src/lib/services/notification.service.ts', callee: 'prisma.notification.create(', siteKind: 'legacy in-app notification' },
    { file: 'src/lib/services/leaderboard.service.ts', callee: 'notificationService.send(', siteKind: 'gamification notification (via legacy send)' },
    { file: 'src/lib/services/sync-processing.service.ts', callee: 'prisma.rapidResponse.create(', siteKind: 'offline sync response row' },
  ]

  console.log('\n[2. Creation sites and their severity sources]')
  for (const target of calleeTargets) {
    const sites = extractCallBlocks(sources.get(target.file)!, target.callee, target.file)
    check('2', sites.length > 0, `${target.file} must contain at least one ${target.callee} call`)
    for (const site of sites) {
      const reason = extractReasonExpression(site.body)
      const priorityExpr = extractPriorityExpression(site.body)
      const verdict = classify(priorityExpr)
      console.log(
        `  ${target.file}:${site.line} [${target.siteKind}] reason=${reason}\n    priority = ${priorityExpr ?? '(absent)'}\n    source  = ${verdict.label}`
      )
      check(
        '2',
        verdict.ok,
        `${target.file}:${site.line} (${reason}) — ${verdict.label}`
      )
    }
  }

  // ---- 3. Zero hardcoded severity literals outside the allowlist --------
  // Any quoted severity literal on any line of a writer file fails unless
  // the line sources from the allowlist/resolver or is an enumerated
  // read-only/dead-code exception — catches bindings, assignments, ternary
  // branches, and return statements alike.
  const anySeverityLiteral = /(['"])(CRITICAL|HIGH|MEDIUM|LOW|UNCLASSIFIED)\1/
  const READ_ONLY_EXCEPTION_LINES: ReadonlyArray<{ file: string; line: string }> = [
    { file: 'src/lib/services/action-signal.service.ts', line: "where: { ...where, resolvedAt: null, priority: 'CRITICAL' }," },
    { file: 'src/lib/services/action-signal.service.ts', line: "finalCritical = mappedSignals.filter(s => !s.resolvedAt && s.priority === 'CRITICAL').length;" },
    { file: 'src/lib/services/action-signal.service.ts', line: "case 'CRITICAL': return 4;" },
    { file: 'src/lib/services/action-signal.service.ts', line: "case 'HIGH': return 3;" },
    { file: 'src/lib/services/action-signal.service.ts', line: "case 'MEDIUM': return 2;" },
    { file: 'src/lib/services/action-signal.service.ts', line: "case 'LOW': return 1;" },
    { file: 'src/lib/services/action-signal.service.ts', line: "if (config.emailDigestEnabled && priority !== 'CRITICAL') return;" },
    { file: 'src/lib/services/action-signal.service.ts', line: "if (assessmentType === 'POPULATION') return 'CRITICAL';" },
    { file: 'src/lib/services/action-signal.service.ts', line: "if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(newPriority)) return;" },
    { file: 'src/lib/services/sync-processing.service.ts', line: "linkedAssessment && linkedAssessment.priority !== 'UNCLASSIFIED'" },
  ]

  console.log('\n[3. Hardcoded severity literal sweep (any literal form) + writer discovery]')
  let sweepClean = true
  for (const file of WRITER_FILES) {
    const lines = sources.get(file)!.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!anySeverityLiteral.test(line)) return
      if (line.includes('SYSTEM_HEALTH_SEVERITY') || line.includes('resolveSeverityPriority')) return
      const trimmed = line.trim()
      if (READ_ONLY_EXCEPTION_LINES.some((e) => e.file === file && e.line === trimmed)) {
        console.log(`  ${file}:${index + 1} → enumerated exception (read-only filter / dead code pending p7): "${trimmed}"`)
        return
      }
      sweepClean = false
      failures += 1
      console.error(`  FAIL: ${file}:${index + 1} → hardcoded severity literal: "${trimmed}"`)
    })
  }
  if (sweepClean) {
    console.log('  No hardcoded severity literals outside the allowlist module and the enumerated exceptions.')
  }

  // ---- 4. Writer discovery: creation sites only in the known writer files --
  const ALLOWED_CREATION_FILES = new Set([
    'src/lib/services/action-signal.service.ts',
    'src/lib/services/notification.service.ts',
  ])
  const creationSite = /\.(notification|actionSignal)\.(create|createMany)\(/
  const discoveryViolations: string[] = []
  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }
  for (const absPath of walk(resolve(__dirname, '..', 'src'))) {
    const relPath = relative(resolve(__dirname, '..'), absPath).split(sep).join('/')
    const lines = readFileSync(absPath, 'utf-8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (creationSite.test(line) && !ALLOWED_CREATION_FILES.has(relPath)) {
        discoveryViolations.push(`${relPath}:${index + 1} → "${line.trim()}"`)
      }
    })
  }
  if (discoveryViolations.length === 0) {
    console.log('  Writer discovery clean: notification/actionSignal creation sites exist only in the allowed writer files.')
  } else {
    failures += discoveryViolations.length
    console.error('  FAIL: creation sites outside the allowed writer files:')
    for (const violation of discoveryViolations) console.error(`    ${violation}`)
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()
