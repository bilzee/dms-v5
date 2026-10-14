import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const maplibrePkg = require.resolve('maplibre-gl/package.json')
const workerSrc = join(dirname(maplibrePkg), 'dist', 'maplibre-gl-worker.mjs')
const outDir = join(root, 'public', 'vendor')
const workerDest = join(outDir, 'maplibre-gl-worker.mjs')

mkdirSync(outDir, { recursive: true })
copyFileSync(workerSrc, workerDest)
console.log(`[copy-maplibre-worker] ${workerSrc} -> ${workerDest}`)
