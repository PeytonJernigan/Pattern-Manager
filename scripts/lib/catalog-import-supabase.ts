import { readFile } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogImportPlan, JsonRecord, PlannedAsset, PlannedPatternAsset } from './catalog-import.ts'
import { findPrivacyViolations, redactPrivateText, sanitizeForDatabase } from './catalog-import.ts'

const BUCKET_NAME = 'pattern-assets'
const QUERY_CHUNK_SIZE = 100

interface ExistingPatternRow {
  id: string
  external_id: string
  import_fingerprint: string | null
  user_modified_at: string | null
  primary_asset_id: string | null
  thumbnail_storage_path: string | null
  deleted_at: string | null
}

interface AssetRow {
  id: string
  sha256: string
  storage_path: string
  deleted_at: string | null
}

interface ImportBatchRow {
  id: string
  status: string
}

export interface ApplyCatalogOptions {
  supabase: SupabaseClient
  resume: boolean
}

export interface ApplyCatalogResult extends JsonRecord {
  batchId: string | null
  noOp: boolean
  patternsInserted: number
  patternsUpdated: number
  patternsSkipped: number
  patternConflicts: number
  patternsFailed: number
  assetsInserted: number
  assetsReused: number
  assetConflicts: number
  assetsFailed: number
  linksUpserted: number
}

function chunks<T>(values: T[], size = QUERY_CHUNK_SIZE): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes('already exists') || message.includes('duplicate') || message.includes('conflict')
}

async function ensurePrivateBucket(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.storage.getBucket(BUCKET_NAME)
  if (error) {
    const missing = errorMessage(error).toLowerCase().includes('not found')
    if (!missing) throw new Error(`Could not inspect the private asset bucket: ${errorMessage(error)}`)
    const created = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      allowedMimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
      ],
    })
    if (created.error) throw new Error(`Could not create the private asset bucket: ${errorMessage(created.error)}`)
    return
  }
  if (data.public) throw new Error(`Refusing to import because ${BUCKET_NAME} is public.`)
}

async function latestMatchingBatch(supabase: SupabaseClient, plan: CatalogImportPlan): Promise<ImportBatchRow | null> {
  const { data, error } = await supabase
    .from('import_batches')
    .select('id,status')
    .eq('household_id', plan.householdId)
    .eq('source_key', plan.sourceKey)
    .eq('manifest_sha256', plan.manifestSha256)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Could not inspect catalog import history: ${error.message}`)
  return data as ImportBatchRow | null
}

async function startBatch(supabase: SupabaseClient, plan: CatalogImportPlan, resume: boolean): Promise<{ batch: ImportBatchRow; noOp: boolean }> {
  const previous = await latestMatchingBatch(supabase, plan)
  if (previous?.status === 'completed') return { batch: previous, noOp: true }
  if (resume && previous) {
    const { data, error } = await supabase
      .from('import_batches')
      .update({ status: 'running', started_at: new Date().toISOString(), error_text: null, updated_at: new Date().toISOString() })
      .eq('id', previous.id)
      .select('id,status')
      .single()
    if (error) throw new Error(`Could not resume the catalog import: ${error.message}`)
    return { batch: data as ImportBatchRow, noOp: false }
  }
  if (previous) throw new Error('A matching incomplete import batch already exists. Re-run with --resume.')

  const { data, error } = await supabase
    .from('import_batches')
    .insert({
      household_id: plan.householdId,
      source_key: plan.sourceKey,
      source_label: plan.sourceLabel,
      manifest_sha256: plan.manifestSha256,
      status: 'running',
      started_at: new Date().toISOString(),
      summary: {
        catalogSha256: plan.catalogSha256,
        schemaVersion: plan.schemaVersion,
        plannedPatterns: plan.stats.plannedPatternCount,
        plannedAssets: plan.stats.uniqueAssetCount,
      },
    })
    .select('id,status')
    .single()
  if (error) throw new Error(`Could not create the catalog import batch: ${error.message}`)
  return { batch: data as ImportBatchRow, noOp: false }
}

async function upsertImportRow(
  supabase: SupabaseClient,
  plan: CatalogImportPlan,
  batchId: string,
  rowNumber: number,
  values: JsonRecord,
): Promise<void> {
  const sanitizedValues = sanitizeForDatabase(values) as JsonRecord
  const payload = sanitizedValues.source_payload ?? {}
  const violations = findPrivacyViolations(sanitizedValues)
  if (violations.length > 0) throw new Error('Refusing to write an import audit row containing private data.')
  const { error } = await supabase.from('import_rows').upsert({
    household_id: plan.householdId,
    batch_id: batchId,
    row_number: rowNumber,
    ...sanitizedValues,
    source_payload: payload,
  }, { onConflict: 'batch_id,row_number' })
  if (error) throw new Error(`Could not write an import audit row: ${error.message}`)
}

async function loadExistingAssets(supabase: SupabaseClient, plan: CatalogImportPlan): Promise<Map<string, AssetRow>> {
  const existing = new Map<string, AssetRow>()
  for (const hashChunk of chunks(plan.assets.map((asset) => asset.sha256))) {
    const { data, error } = await supabase
      .from('assets')
      .select('id,sha256,storage_path,deleted_at')
      .eq('household_id', plan.householdId)
      .in('sha256', hashChunk)
    if (error) throw new Error(`Could not inspect existing assets: ${error.message}`)
    for (const row of (data ?? []) as AssetRow[]) existing.set(row.sha256, row)
  }
  return existing
}

async function insertAssetRow(supabase: SupabaseClient, plan: CatalogImportPlan, asset: PlannedAsset, batchId: string): Promise<AssetRow> {
  const { data, error } = await supabase
    .from('assets')
    .insert({
      household_id: plan.householdId,
      storage_bucket: BUCKET_NAME,
      storage_path: asset.storagePath,
      original_name: asset.originalName,
      mime_type: asset.mimeType,
      byte_size: asset.byteSize,
      sha256: asset.sha256,
      page_count: asset.pageCount,
      language: asset.language,
      role: asset.roles.length === 1 ? asset.roles[0] : 'catalog_asset',
      metadata: {
        importBatchId: batchId,
        sourceKey: plan.sourceKey,
        catalogRoles: asset.roles,
        sourceFileIds: asset.sourceFileIds,
      },
    })
    .select('id,sha256,storage_path,deleted_at')
    .single()
  if (!error) return data as AssetRow

  if (!isAlreadyExistsError(error)) throw new Error(`Could not register an imported asset: ${error.message}`)
  const fetched = await supabase
    .from('assets')
    .select('id,sha256,storage_path,deleted_at')
    .eq('household_id', plan.householdId)
    .eq('sha256', asset.sha256)
    .single()
  if (fetched.error) throw new Error(`Could not recover a concurrently registered asset: ${fetched.error.message}`)
  return fetched.data as AssetRow
}

async function uploadAndRegisterAssets(
  supabase: SupabaseClient,
  plan: CatalogImportPlan,
  batchId: string,
  result: ApplyCatalogResult,
): Promise<Map<string, AssetRow>> {
  const assetRows = await loadExistingAssets(supabase, plan)
  let rowNumber = plan.patterns.length + 1

  for (const asset of plan.assets) {
    const existing = assetRows.get(asset.sha256)
    if (existing) {
      if (existing.deleted_at) {
        result.assetConflicts += 1
        assetRows.delete(asset.sha256)
        await upsertImportRow(supabase, plan, batchId, rowNumber, {
          entity_type: 'asset',
          external_id: asset.sha256,
          source_fingerprint: asset.sha256,
          status: 'conflict',
          asset_id: existing.id,
          message: 'Matching content was previously deleted by a user; it was not restored or linked.',
          source_payload: { sha256: asset.sha256, byteSize: asset.byteSize, mimeType: asset.mimeType, roles: asset.roles, storagePath: asset.storagePath },
        })
        rowNumber += 1
        continue
      }
      result.assetsReused += 1
      await upsertImportRow(supabase, plan, batchId, rowNumber, {
        entity_type: 'asset',
        external_id: asset.sha256,
        source_fingerprint: asset.sha256,
        status: 'skipped',
        asset_id: existing.id,
        message: 'Content-addressed asset already exists.',
        source_payload: { sha256: asset.sha256, byteSize: asset.byteSize, mimeType: asset.mimeType, roles: asset.roles, storagePath: asset.storagePath },
      })
      rowNumber += 1
      continue
    }

    try {
      const file = await readFile(asset.localPath)
      const uploaded = await supabase.storage.from(BUCKET_NAME).upload(asset.storagePath, file, {
        contentType: asset.mimeType,
        cacheControl: '0',
        upsert: false,
      })
      if (uploaded.error && !isAlreadyExistsError(uploaded.error)) throw uploaded.error
      const row = await insertAssetRow(supabase, plan, asset, batchId)
      assetRows.set(asset.sha256, row)
      result.assetsInserted += 1
      await upsertImportRow(supabase, plan, batchId, rowNumber, {
        entity_type: 'asset',
        external_id: asset.sha256,
        source_fingerprint: asset.sha256,
        status: 'inserted',
        asset_id: row.id,
        message: uploaded.error ? 'Storage object was already present; database row registered.' : 'Private asset uploaded and registered.',
        source_payload: { sha256: asset.sha256, byteSize: asset.byteSize, mimeType: asset.mimeType, roles: asset.roles, storagePath: asset.storagePath },
      })
    } catch (error) {
      result.assetsFailed += 1
      await upsertImportRow(supabase, plan, batchId, rowNumber, {
        entity_type: 'asset',
        external_id: asset.sha256,
        source_fingerprint: asset.sha256,
        status: 'failed',
        message: `Asset import failed: ${errorMessage(error)}`,
        source_payload: { sha256: asset.sha256, byteSize: asset.byteSize, mimeType: asset.mimeType, roles: asset.roles, storagePath: asset.storagePath },
      })
    }
    rowNumber += 1
  }
  return assetRows
}

async function loadExistingPatterns(supabase: SupabaseClient, plan: CatalogImportPlan): Promise<Map<string, ExistingPatternRow>> {
  const existing = new Map<string, ExistingPatternRow>()
  for (const idChunk of chunks(plan.patterns.map((pattern) => pattern.externalId))) {
    const { data, error } = await supabase
      .from('patterns')
      .select('id,external_id,import_fingerprint,user_modified_at,primary_asset_id,thumbnail_storage_path,deleted_at')
      .eq('household_id', plan.householdId)
      .in('external_id', idChunk)
    if (error) throw new Error(`Could not inspect existing patterns: ${error.message}`)
    for (const row of (data ?? []) as ExistingPatternRow[]) existing.set(row.external_id, row)
  }
  return existing
}

function linksForPattern(plan: CatalogImportPlan, externalId: string): PlannedPatternAsset[] {
  return plan.patternAssets.filter((link) => link.patternExternalId === externalId)
}

async function linkAssets(
  supabase: SupabaseClient,
  plan: CatalogImportPlan,
  patternId: string,
  links: PlannedPatternAsset[],
  assetRows: Map<string, AssetRow>,
  result: ApplyCatalogResult,
): Promise<void> {
  const rows = links.flatMap((link) => {
    const asset = assetRows.get(link.assetSha256)
    return asset ? [{
      household_id: plan.householdId,
      pattern_id: patternId,
      asset_id: asset.id,
      role: link.role,
      is_primary: link.isPrimary,
      sort_order: link.role === 'primary_instructions' ? 0 : 1,
    }] : []
  })
  if (rows.length === 0) return
  const primary = rows.find((row) => row.is_primary)
  if (primary) {
    const cleared = await supabase
      .from('pattern_assets')
      .update({ is_primary: false })
      .eq('pattern_id', patternId)
      .eq('is_primary', true)
      .neq('asset_id', primary.asset_id)
    if (cleared.error) throw new Error(`Could not replace the imported primary asset link: ${cleared.error.message}`)
  }
  const { error } = await supabase.from('pattern_assets').upsert(rows, { onConflict: 'pattern_id,asset_id' })
  if (error) throw new Error(`Could not link imported pattern assets: ${error.message}`)
  result.linksUpserted += rows.length
}

async function importPatterns(
  supabase: SupabaseClient,
  plan: CatalogImportPlan,
  batchId: string,
  assetRows: Map<string, AssetRow>,
  result: ApplyCatalogResult,
): Promise<void> {
  const existingByExternalId = await loadExistingPatterns(supabase, plan)
  let rowNumber = 1

  for (const pattern of plan.patterns) {
    const existing = existingByExternalId.get(pattern.externalId)
    const links = linksForPattern(plan, pattern.externalId)
    const primary = links.find((link) => link.role === 'primary_instructions')
    const thumbnail = links.find((link) => link.role === 'thumbnail')
    const primaryAsset = primary ? assetRows.get(primary.assetSha256) : undefined
    const thumbnailAsset = thumbnail ? assetRows.get(thumbnail.assetSha256) : undefined
    const sourcePayload = {
      externalId: pattern.externalId,
      importFingerprint: pattern.importFingerprint,
      primaryAssetSha256: primary?.assetSha256 ?? null,
      thumbnailAssetSha256: thumbnail?.assetSha256 ?? null,
    }

    if (existing?.user_modified_at || existing?.deleted_at) {
      result.patternConflicts += 1
      await upsertImportRow(supabase, plan, batchId, rowNumber, {
        entity_type: 'pattern', external_id: pattern.externalId, source_fingerprint: pattern.importFingerprint,
        status: 'conflict', pattern_id: existing.id,
        message: existing.deleted_at
          ? 'Pattern was previously deleted by a user; it was not restored or overwritten.'
          : 'Pattern has user edits; catalog values and asset roles were not overwritten.', source_payload: sourcePayload,
      })
      rowNumber += 1
      continue
    }

    const databaseRow: JsonRecord = {
      ...pattern.row,
      household_id: plan.householdId,
      import_batch_id: batchId,
      import_fingerprint: pattern.importFingerprint,
      primary_asset_id: primaryAsset?.id ?? null,
      thumbnail_storage_path: thumbnailAsset?.storage_path ?? null,
    }

    try {
      let patternId: string
      let rowStatus: 'inserted' | 'updated' | 'skipped'
      if (!existing) {
        const inserted = await supabase.from('patterns').insert(databaseRow).select('id').single()
        if (inserted.error) throw inserted.error
        patternId = String(inserted.data.id)
        rowStatus = 'inserted'
        result.patternsInserted += 1
      } else if (existing.import_fingerprint === pattern.importFingerprint
        && existing.primary_asset_id === (primaryAsset?.id ?? null)
        && existing.thumbnail_storage_path === (thumbnailAsset?.storage_path ?? null)) {
        patternId = existing.id
        rowStatus = 'skipped'
        result.patternsSkipped += 1
      } else {
        const updated = await supabase
          .from('patterns')
          .update(databaseRow)
          .eq('id', existing.id)
          .is('user_modified_at', null)
          .select('id')
          .maybeSingle()
        if (updated.error) throw updated.error
        if (!updated.data) {
          result.patternConflicts += 1
          await upsertImportRow(supabase, plan, batchId, rowNumber, {
            entity_type: 'pattern', external_id: pattern.externalId, source_fingerprint: pattern.importFingerprint,
            status: 'conflict', pattern_id: existing.id,
            message: 'Pattern was edited while the import was running; catalog values were not overwritten.', source_payload: sourcePayload,
          })
          rowNumber += 1
          continue
        }
        patternId = existing.id
        rowStatus = 'updated'
        result.patternsUpdated += 1
      }

      await linkAssets(supabase, plan, patternId, links, assetRows, result)
      await upsertImportRow(supabase, plan, batchId, rowNumber, {
        entity_type: 'pattern', external_id: pattern.externalId, source_fingerprint: pattern.importFingerprint,
        status: rowStatus, pattern_id: patternId,
        message: rowStatus === 'skipped' ? 'Catalog pattern is already current.' : `Catalog pattern ${rowStatus}.`, source_payload: sourcePayload,
      })
    } catch (error) {
      result.patternsFailed += 1
      await upsertImportRow(supabase, plan, batchId, rowNumber, {
        entity_type: 'pattern', external_id: pattern.externalId, source_fingerprint: pattern.importFingerprint,
        status: 'failed', pattern_id: existing?.id ?? null,
        message: `Pattern import failed: ${errorMessage(error)}`, source_payload: sourcePayload,
      })
    }
    rowNumber += 1
  }
}

async function finishBatch(supabase: SupabaseClient, batchId: string, result: ApplyCatalogResult): Promise<void> {
  const failures = result.patternsFailed + result.assetsFailed
  const status = failures > 0 ? 'completed_with_errors' : 'completed'
  const { error } = await supabase.from('import_batches').update({
    status,
    completed_at: new Date().toISOString(),
    summary: result,
    error_text: failures > 0 ? `${failures} import item(s) failed. Review import_rows.` : null,
    updated_at: new Date().toISOString(),
  }).eq('id', batchId)
  if (error) throw new Error(`Catalog data was processed, but the import batch could not be finalized: ${error.message}`)
}

export async function applyCatalogImport(plan: CatalogImportPlan, options: ApplyCatalogOptions): Promise<ApplyCatalogResult> {
  const fatalPlanIssues = plan.issues.filter((issue) => issue.severity === 'error')
  if (fatalPlanIssues.length > 0) throw new Error(`Refusing to apply a catalog plan with ${fatalPlanIssues.length} error(s).`)
  await ensurePrivateBucket(options.supabase)
  const { batch, noOp } = await startBatch(options.supabase, plan, options.resume)
  const result: ApplyCatalogResult = {
    batchId: batch.id,
    noOp,
    patternsInserted: 0,
    patternsUpdated: 0,
    patternsSkipped: 0,
    patternConflicts: 0,
    patternsFailed: 0,
    assetsInserted: 0,
    assetsReused: 0,
    assetConflicts: 0,
    assetsFailed: 0,
    linksUpserted: 0,
  }
  if (noOp) return result

  try {
    const assetRows = await uploadAndRegisterAssets(options.supabase, plan, batch.id, result)
    await importPatterns(options.supabase, plan, batch.id, assetRows, result)
    await finishBatch(options.supabase, batch.id, result)
    return result
  } catch (error) {
    await options.supabase.from('import_batches').update({
      status: 'failed',
      error_text: redactPrivateText(errorMessage(error)),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', batch.id)
    throw error
  }
}
