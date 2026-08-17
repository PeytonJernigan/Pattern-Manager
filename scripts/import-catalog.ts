#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { applyCatalogImport } from './lib/catalog-import-supabase.ts'
import {
  buildCatalogImportPlan,
  readCatalogDocument,
  toSafeImportReport,
  validateHouseholdId,
  type JsonRecord,
} from './lib/catalog-import.ts'

interface CliOptions {
  catalogPath: string
  manifestPath: string | null
  assetRoot: string
  householdId: string
  reportPath: string
  apply: boolean
  resume: boolean
  includePrimary: boolean
  includeThumbnails: boolean
}

function usage(): string {
  return `Pattern Manager private catalog importer

Dry-run is the default. Database and Storage changes require --apply.

Required:
  --catalog <catalog_data.json>   Consolidated fiber catalog outside this repository
  --asset-root <directory>       Local Digital Patterns root used only to read assets
  --household-id <uuid>          Destination household

Optional:
  --manifest <manifest.json>     Verifies the catalog hash and identifies the import
  --assets <selection>           primary,thumbnails (default), primary, thumbnails, or none
  --report <file.json>           Safe report path; defaults to the operating-system temp folder
  --dry-run                      Explicitly plan and verify without making any changes
  --resume                       Resume the newest incomplete matching import batch
  --apply                        Explicitly upload and upsert into Supabase
  --help                         Show this help

Apply mode reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the local process only.
The service credential is never written to a report or browser bundle.`
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

function parseAssetSelection(value: string): { includePrimary: boolean; includeThumbnails: boolean } {
  const tokens = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  const allowed = new Set(['primary', 'thumbnails', 'none'])
  if (tokens.length === 0 || tokens.some((token) => !allowed.has(token)) || (tokens.includes('none') && tokens.length > 1)) {
    throw new Error('--assets must be primary, thumbnails, primary,thumbnails, or none.')
  }
  return { includePrimary: tokens.includes('primary'), includeThumbnails: tokens.includes('thumbnails') }
}

export function parseCliOptions(args: string[], temporaryDirectory = os.tmpdir()): CliOptions {
  let catalogPath = ''
  let manifestPath: string | null = null
  let assetRoot = ''
  let householdId = ''
  let reportPath = ''
  let apply = false
  let explicitDryRun = false
  let resume = false
  let includePrimary = true
  let includeThumbnails = true

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    switch (flag) {
      case '--catalog': catalogPath = nextValue(args, index++, flag); break
      case '--manifest': manifestPath = nextValue(args, index++, flag); break
      case '--asset-root': assetRoot = nextValue(args, index++, flag); break
      case '--household-id': householdId = nextValue(args, index++, flag); break
      case '--report': reportPath = nextValue(args, index++, flag); break
      case '--assets': {
        const selection = parseAssetSelection(nextValue(args, index++, flag))
        includePrimary = selection.includePrimary
        includeThumbnails = selection.includeThumbnails
        break
      }
      case '--dry-run': explicitDryRun = true; break
      case '--apply': apply = true; break
      case '--resume': resume = true; break
      case '--help':
      case '-h': throw new Error('__HELP__')
      default: throw new Error(`Unknown option: ${flag}`)
    }
  }

  if (!catalogPath) throw new Error('--catalog is required.')
  if (apply && explicitDryRun) throw new Error('--apply and --dry-run cannot be used together.')
  if (!assetRoot && (includePrimary || includeThumbnails)) throw new Error('--asset-root is required unless --assets none is used.')
  if (!householdId) throw new Error('--household-id is required.')
  householdId = validateHouseholdId(householdId)
  if (!reportPath) {
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    reportPath = path.join(temporaryDirectory, 'pattern-manager-import-reports', `catalog-import-${stamp}.json`)
  }
  return { catalogPath, manifestPath, assetRoot, householdId, reportPath, apply, resume, includePrimary, includeThumbnails }
}

async function sha256Path(filePath: string): Promise<string> {
  const contents = await readFile(filePath)
  return createHash('sha256').update(contents).digest('hex')
}

async function verifyManifest(manifestPath: string | null, catalogSha256: string): Promise<string> {
  if (!manifestPath) return catalogSha256
  const contents = await readFile(manifestPath, 'utf8')
  const parsed: unknown = JSON.parse(contents)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Manifest must be a JSON object.')
  const expected = 'catalog_sha256' in parsed && typeof parsed.catalog_sha256 === 'string'
    ? parsed.catalog_sha256.toLowerCase()
    : null
  if (expected && expected !== catalogSha256) throw new Error('Catalog checksum does not match the supplied manifest.')
  return createHash('sha256').update(contents, 'utf8').digest('hex')
}

function requireApplyEnvironment(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) {
    throw new Error('Apply mode requires local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.')
  }
  if (serviceRoleKey === process.env.VITE_SUPABASE_ANON_KEY || serviceRoleKey === process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Apply mode requires a server-only service credential, not the browser publishable key.')
  }
  return { url, serviceRoleKey }
}

async function writeReport(reportPath: string, report: unknown): Promise<void> {
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function main(): Promise<void> {
  let options: CliOptions
  try {
    options = parseCliOptions(process.argv.slice(2))
  } catch (error) {
    if (error instanceof Error && error.message === '__HELP__') {
      console.log(usage())
      return
    }
    throw error
  }

  const catalogSha256 = await sha256Path(options.catalogPath)
  const manifestSha256 = await verifyManifest(options.manifestPath, catalogSha256)
  const catalog = await readCatalogDocument(options.catalogPath)
  const plan = await buildCatalogImportPlan(catalog, {
    householdId: options.householdId,
    assetRoot: options.assetRoot,
    catalogSha256,
    manifestSha256,
    includePrimary: options.includePrimary,
    includeThumbnails: options.includeThumbnails,
  })

  let applyResult: JsonRecord | undefined
  if (options.apply) {
    const environment = requireApplyEnvironment()
    const supabase = createClient(environment.url, environment.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-client-info': 'pattern-manager-local-importer/1.0' } },
    })
    applyResult = await applyCatalogImport(plan, { supabase, resume: options.resume })
  }

  const report = toSafeImportReport(plan, options.apply ? 'apply' : 'dry-run', applyResult)
  await writeReport(options.reportPath, report)
  const errors = plan.issues.filter((issue) => issue.severity === 'error').length
  const warnings = plan.issues.filter((issue) => issue.severity === 'warning').length
  console.log(`${options.apply ? 'Apply' : 'Dry-run'} complete: ${plan.stats.plannedPatternCount} patterns, ${plan.stats.uniqueAssetCount} private assets, ${errors} errors, ${warnings} warnings.`)
  console.log(`Safe report: ${path.resolve(options.reportPath)}`)
  if (errors > 0) process.exitCode = 2
}

const isDirectExecution = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Catalog import stopped: ${message}`)
    process.exitCode = 1
  })
}
