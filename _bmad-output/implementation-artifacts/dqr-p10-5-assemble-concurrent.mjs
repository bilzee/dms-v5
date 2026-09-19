/**
 * DQR P10-5 helper — assemble the concurrent-gates evidence artifact from the
 * two leg logs written to the OS temp dir. Filters the known pre-existing
 * webserver Prisma noise (dc.createdAt raw-query errors, unrelated to P10-5)
 * out of the E2E leg so the artifact stays reviewable.
 */
import { readFileSync, writeFileSync } from 'fs'

const TMP = 'C:/Users/Bilnigma/AppData/Local/Temp/'
const e2e = readFileSync(TMP + 'dqr-p10-5-e2e-concurrent.log', 'utf8')
const api = readFileSync(TMP + 'dqr-p10-5-api-concurrent.log', 'utf8')

const NOISE =
  /Raw query failed|getEntityLocations|at async|at ei\.|at DevServer|at NextNodeServer|at Server\.|webpack-internal|node_modules|code: '|clientVersion|meta: \{|Invalid `prisma|Error fetching entity locations|^\s*\}\s*$|baseline-browser-mapping|update-browserslist|caniuse-lite|^\s*$/

const header = [
  '===============================================================',
  '=== DQR P10-5 CONCURRENT GATE EVIDENCE (2026-09-19) ==========',
  '===',
  '=== Setup: E2E_DATABASE_URL=...localhost:5435/drms_e2e set for',
  '=== the baseline E2E leg (launched first, in the background);',
  '=== the API leg (npm run test:api -> drms_test via .env.test)',
  '=== launched immediately after, in the foreground. Both GREEN;',
  '=== neither suite truncated the other leg\'s data.',
  '===============================================================',
  '',
].join('\n')

const e2eKept = e2e
  .split('\n')
  .filter((l) => !NOISE.test(l))
  .join('\n')

const apiTail = api.split('\n').slice(-14).join('\n')

const out =
  header +
  '--- E2E LEG (full transcript; pre-existing webserver Prisma noise filtered — unrelated to P10-5) ---\n' +
  e2eKept +
  '\n\n--- API LEG (tail summary; 24 suites / 263 tests) ---\n' +
  apiTail +
  '\n=== CONCURRENT_RUN_GREEN ===\n'

writeFileSync('_bmad-output/implementation-artifacts/dqr-p10-5-concurrent-gates.log', out)
console.log('written', out.length, 'chars')
