import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export type JsonRecord = Record<string, unknown>

export interface CatalogDocument extends JsonRecord {
  schema_version?: string
  generated_on?: string
  patterns: JsonRecord[]
  files?: JsonRecord[]
  screenshots_images?: JsonRecord[]
  pattern_details?: JsonRecord[]
  sources?: JsonRecord[]
  sizes_measurements?: JsonRecord[]
  yarn_requirements?: JsonRecord[]
  materials?: JsonRecord[]
  gauge?: JsonRecord[]
  time_estimates?: JsonRecord[]
  thumbnail_palette?: JsonRecord[]
  pattern_tags?: JsonRecord[]
  creators?: JsonRecord[]
  creator_links?: JsonRecord[]
  pattern_credits?: JsonRecord[]
  needs_review?: JsonRecord[]
}

export type AssetRole = 'primary_instructions' | 'thumbnail'

export interface ImportIssue {
  severity: 'error' | 'warning'
  code: string
  externalId?: string
  message: string
}

export interface PlannedAsset {
  sha256: string
  byteSize: number
  mimeType: string
  extension: string
  storagePath: string
  originalName: string
  localPath: string
  roles: AssetRole[]
  patternExternalIds: string[]
  pageCount: number | null
  language: string | null
  sourceFileIds: string[]
}

export interface PlannedPatternAsset {
  patternExternalId: string
  assetSha256: string
  role: AssetRole
  isPrimary: boolean
}

export interface PlannedPattern {
  externalId: string
  importFingerprint: string
  row: JsonRecord
}

export interface CatalogImportPlan {
  sourceKey: string
  sourceLabel: string
  schemaVersion: string
  catalogSha256: string
  manifestSha256: string
  householdId: string
  patterns: PlannedPattern[]
  assets: PlannedAsset[]
  patternAssets: PlannedPatternAsset[]
  issues: ImportIssue[]
  stats: {
    catalogPatternCount: number
    plannedPatternCount: number
    uniqueAssetCount: number
    primaryAssetLinks: number
    thumbnailAssetLinks: number
    totalAssetBytes: number
    assetsOver50MiB: number
  }
}

export interface SafeImportReport {
  schemaVersion: '1.0.0'
  mode: 'dry-run' | 'apply'
  generatedAt: string
  source: {
    sourceKey: string
    sourceLabel: string
    catalogSchemaVersion: string
    catalogSha256: string
    manifestSha256: string
  }
  destination: {
    householdId: string
    bucket: 'pattern-assets'
  }
  counts: CatalogImportPlan['stats']
  issues: ImportIssue[]
  assets: Array<{
    sha256: string
    byteSize: number
    mimeType: string
    storagePath: string
    roles: AssetRole[]
    referenceCount: number
  }>
  apply?: JsonRecord
}

export interface BuildPlanOptions {
  householdId: string
  assetRoot: string
  catalogSha256: string
  manifestSha256?: string
  includePrimary?: boolean
  includeThumbnails?: boolean
  sourceKey?: string
  sourceLabel?: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PATTERN_EXTERNAL_ID = /^PAT-\d{6}$/
const WINDOWS_ABSOLUTE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/
const UNC_PATH = /(?:^|[\s"'])(?:\\\\|\/\/)[^/\\\s]+[\\/][^\s"']+/
const POSIX_HOME_PATH = /(?:^|[\s"'])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?:\/|$)/i
const FILE_URL = /file:(?:\/{2,3}|\\{2})/i
const PRIVATE_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|::1)(?::\d+)?$/i
const LOCAL_ONLY_KEYS = new Set([
  'storage_root',
  'relative_path',
  'folder_relative_path',
  'primary_pdf_relative_path',
  'primary_instructions_relative_path',
  'thumbnail_relative_path',
  'pattern_record_relative_path',
  'excel_relative_link',
  'text_path',
  'source_file',
  'folder_link',
  'pdf_link',
  'screenshot_link',
  'thumbnail_path',
  'asset_root',
  'catalog_path',
  'local_path',
  'manifest_path',
  'report_path',
])
const NORMALIZED_LOCAL_ONLY_KEYS = new Set([...LOCAL_ONLY_KEYS].map((key) => key.replaceAll('_', '').replaceAll('-', '')))
const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'auth',
  'credential',
  'download_token',
  'key',
  'policy',
  'secret',
  'session',
  'signature',
  'sig',
  'token',
  'transaction_id',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-expires',
  'x-amz-security-token',
  'x-amz-signature',
  'x-goog-credential',
  'x-goog-date',
  'x-goog-expires',
  'x-goog-signature',
])
const TRACKING_QUERY_KEYS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref_', 'source'])

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isLocalOnlyKey(key: string): boolean {
  return NORMALIZED_LOCAL_ONLY_KEYS.has(key.toLowerCase().replaceAll('_', '').replaceAll('-', ''))
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asString).filter((item): item is string => item !== null)
}

function compactObject(entries: Array<[string, unknown]>): JsonRecord {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined && value !== ''))
}

function cleanText(value: unknown, maximumLength = 2_000): string | null {
  const text = asString(value)
  if (!text) return null
  const redacted = redactPrivateText(text)
  if (redacted.length <= maximumLength) return redacted
  return `${redacted.slice(0, maximumLength - 1).trimEnd()}…`
}

export function hasPrivatePath(value: string): boolean {
  return WINDOWS_ABSOLUTE_PATH.test(value) || UNC_PATH.test(value) || POSIX_HOME_PATH.test(value) || FILE_URL.test(value)
}

export function redactPrivateText(value: string): string {
  if (!hasPrivatePath(value)) return value
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/\/[^/\\\s]+[\\/]|file:|\/Users\/|\/home\/)/i.test(value.trim())) {
    return '[local path removed]'
  }
  return value
    .replace(/file:(?:\/{2,3}|\\{2})[^\s"'<>]+/gi, '[local path removed]')
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n"'<>]*/g, '[local path removed]')
    .replace(/(?:\\\\|\/\/)[^/\\\s]+[\\/][^\r\n"'<>]*/g, '[local path removed]')
    .replace(/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)\/[^\r\n"'<>]*/gi, '[local path removed]')
}

export function sanitizePublicUrl(value: unknown): string | null {
  const raw = asString(value)
  if (!raw || hasPrivatePath(raw)) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (PRIVATE_HOST.test(parsed.host) || parsed.hostname.endsWith('.local')) return null
  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''

  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase()
    if (SENSITIVE_QUERY_KEYS.has(lower) || TRACKING_QUERY_KEYS.has(lower) || lower.startsWith('utm_')) {
      parsed.searchParams.delete(key)
    }
  }
  parsed.searchParams.sort()
  return parsed.toString()
}

export function sanitizeForDatabase(value: unknown, key?: string): unknown {
  if (key && isLocalOnlyKey(key)) return undefined
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    if (key && /(?:url|website|link)$/i.test(key)) return sanitizePublicUrl(value)
    return redactPrivateText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForDatabase(item)).filter((item) => item !== undefined)
  }
  if (isRecord(value)) {
    const sanitized: JsonRecord = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      const next = sanitizeForDatabase(childValue, childKey)
      if (next !== undefined) sanitized[childKey] = next
    }
    return sanitized
  }
  return value
}

export function findPrivacyViolations(value: unknown, keyPath = '$'): string[] {
  const violations: string[] = []
  if (typeof value === 'string') {
    if (hasPrivatePath(value)) violations.push(`${keyPath}: local path`)
    try {
      const parsed = new URL(value)
      for (const key of parsed.searchParams.keys()) {
        const lower = key.toLowerCase()
        if (SENSITIVE_QUERY_KEYS.has(lower)) violations.push(`${keyPath}: signed or private query parameter`)
      }
    } catch {
      // Non-URL strings are checked only for local path content.
    }
    return violations
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...findPrivacyViolations(item, `${keyPath}[${index}]`)))
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (isLocalOnlyKey(key)) violations.push(`${keyPath}.${key}: local-only key`)
      violations.push(...findPrivacyViolations(child, `${keyPath}.${key}`))
    }
  }
  return violations
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForStableJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeForStableJson(value[key])]),
  )
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value))
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(filePath)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function readCatalogDocument(filePath: string): Promise<CatalogDocument> {
  const raw = await readFile(filePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !Array.isArray(parsed.patterns)) {
    throw new Error('Catalog must be an object containing a patterns array.')
  }
  return parsed as CatalogDocument
}

export function validateHouseholdId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error('Household ID must be a UUID.')
  return value.toLowerCase()
}

function normalizedPathSegments(relativePath: string): string[] {
  if (path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath) || FILE_URL.test(relativePath)) {
    throw new Error('Catalog asset path must be relative to the supplied asset root.')
  }
  return relativePath.split(/[\\/]+/).map((segment) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      decoded = segment
    }
    if (decoded === '..' || decoded === '.') throw new Error('Catalog asset path contains traversal segments.')
    return segment
  }).filter(Boolean)
}

export function resolveCatalogAsset(assetRoot: string, relativePath: string): string {
  const root = path.resolve(assetRoot)
  const candidate = path.resolve(root, ...normalizedPathSegments(relativePath))
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return candidate
  }
  throw new Error('Catalog asset path escapes the supplied asset root.')
}

function rowsForPattern(rows: JsonRecord[] | undefined): Map<string, JsonRecord[]> {
  const grouped = new Map<string, JsonRecord[]>()
  for (const row of rows ?? []) {
    const patternId = asString(row.pattern_id)
    if (!patternId) continue
    const list = grouped.get(patternId) ?? []
    list.push(row)
    grouped.set(patternId, list)
  }
  return grouped
}

function selectFields(row: JsonRecord, fields: string[], stringLimit = 1_000): JsonRecord {
  const selected: JsonRecord = {}
  for (const key of fields) {
    const value = row[key]
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'string') selected[key] = cleanText(value, stringLimit)
    else selected[key] = sanitizeForDatabase(value, key)
  }
  return selected
}

function firstPublicUrl(row: JsonRecord, fields: string[]): string | null {
  for (const field of fields) {
    const url = sanitizePublicUrl(row[field])
    if (url) return url
  }
  return null
}

function mapSource(row: JsonRecord): JsonRecord {
  return compactObject([
    ['externalId', asString(row.source_id)],
    ['type', asString(row.source_type)],
    ['url', firstPublicUrl(row, ['source_url', 'url'])],
    ['publisher', cleanText(row.publisher, 300)],
    ['freeStatus', asString(row.free_status)],
    ['accessRequirement', asString(row.access_requirement)],
    ['availability', asString(row.availability)],
    ['price', asNumber(row.price)],
    ['currency', asString(row.currency)],
    ['verificationDate', asString(row.verification_date ?? row.verified_on)],
    ['confidence', asString(row.confidence)],
    ['copyrightOrLicenseNote', cleanText(row.copyright_or_license_note, 800)],
    ['usageRights', cleanText(row.usage_rights, 500)],
    ['redistributionPermission', cleanText(row.redistribution_permission, 500)],
  ])
}

function mapSize(row: JsonRecord): JsonRecord {
  return selectFields(row, [
    'size_id', 'original_label', 'normalized_label', 'original_size_label', 'normalized_size',
    'age_or_body_group', 'age_group', 'sample_size', 'source_page', 'confidence',
  ], 300)
}

function mapMeasurement(row: JsonRecord): JsonRecord {
  return selectFields(row, [
    'measurement_id', 'size_label', 'measurement_type', 'measurement_name_original', 'value_original',
    'original_value_text', 'unit_original', 'value_normalized', 'normalized_value', 'normalized_value_min',
    'normalized_value_max', 'unit_normalized', 'normalized_unit', 'source_page', 'confidence', 'normalization_note',
  ], 400)
}

function mapYarn(row: JsonRecord): JsonRecord {
  return selectFields(row, [
    'yarn_requirement_id', 'size_label', 'option_label', 'variant_label', 'yarn_role', 'color_role', 'brand',
    'yarn_brand', 'line', 'yarn_line', 'weight', 'yarn_weight_label', 'fiber', 'fiber_content', 'shade_name',
    'shade_code', 'balls_or_skeins', 'published_balls_or_skeins', 'balls_published', 'skeins_published',
    'published_quantity', 'published_unit', 'published_min', 'published_max', 'normalized_grams',
    'normalized_yards', 'normalized_yards_min', 'normalized_yards_max', 'normalized_meters',
    'normalized_meters_min', 'normalized_meters_max', 'quantity_basis', 'quantity_basis_code', 'confidence',
    'is_optional', 'conversion_status',
  ], 500)
}

function mapMaterial(row: JsonRecord): JsonRecord {
  return selectFields(row, [
    'material_id', 'material_type', 'item', 'specification', 'description', 'quantity', 'required_or_optional',
    'required', 'source_page', 'confidence',
  ], 1_000)
}

function mapGauge(row: JsonRecord): JsonRecord {
  return selectFields(row, [
    'gauge_id', 'statement', 'gauge_text', 'stitch_count', 'row_count', 'measurement', 'unit', 'stitch_pattern',
    'source_page', 'confidence',
  ], 1_200)
}

function mapTime(row: JsonRecord): JsonRecord {
  return selectFields(row, [
    'time_estimate_id', 'size_label', 'active_hours_min', 'active_hours_max', 'time_band', 'method',
    'source_count', 'confidence', 'note',
  ], 600)
}

function mapPalette(row: JsonRecord): JsonRecord {
  return selectFields(row, [
    'palette_id', 'rank', 'plain_name', 'common_color_name', 'color_name', 'color_family', 'hex',
    'approximate_share', 'visual_proportion', 'yarn_role', 'role', 'official_yarn_shade', 'confidence',
    'requires_visual_review',
  ], 300)
}

function mapReview(row: JsonRecord): JsonRecord {
  return compactObject([
    ['externalId', asString(row.review_id)],
    ['reason', cleanText(row.review_reason, 300)],
    ['priority', asString(row.priority)],
    ['details', cleanText(row.details, 2_000)],
    ['recommendedAction', cleanText(row.recommended_action, 1_000)],
    ['status', asString(row.status)],
  ])
}

function buildPatternMetadata(
  catalog: CatalogDocument,
  pattern: JsonRecord,
  detail: JsonRecord | undefined,
  related: Record<string, Map<string, JsonRecord[]>>,
  creatorsById: Map<string, JsonRecord>,
  creatorLinksById: Map<string, JsonRecord[]>,
): JsonRecord {
  const externalId = asString(pattern.pattern_id) ?? ''
  const credits = (related.credits.get(externalId) ?? []).map((credit) => {
    const creatorId = asString(credit.creator_id)
    const creator = creatorId ? creatorsById.get(creatorId) : undefined
    return compactObject([
      ['externalId', asString(credit.pattern_credit_id)],
      ['creatorExternalId', creatorId],
      ['name', cleanText(creator?.display_name ?? creator?.designer_name, 300)],
      ['role', asString(credit.credit_role)],
      ['printedByline', cleanText(credit.printed_byline, 500)],
      ['brandOrStudio', cleanText(credit.brand_or_studio, 300)],
      ['displayOrder', asNumber(credit.display_order)],
      ['confidence', asString(credit.confidence)],
      ['links', creatorId ? (creatorLinksById.get(creatorId) ?? []).map((link) => compactObject([
        ['platform', asString(link.platform)],
        ['handle', cleanText(link.handle, 200)],
        ['url', sanitizePublicUrl(link.url)],
        ['isPrimary', asBoolean(link.is_primary)],
      ])) : []],
    ])
  })
  const sizeRows = related.sizes.get(externalId) ?? []

  return sanitizeForDatabase(compactObject([
    ['catalog', compactObject([
      ['schemaVersion', asString(pattern.schema_version ?? catalog.schema_version)],
      ['origin', asString(pattern.origin)],
      ['originCode', asString(pattern.origin_code)],
      ['recordType', asString(pattern.record_type)],
      ['brand', cleanText(pattern.brand, 300)],
      ['itemCode', cleanText(pattern.item_code, 200)],
      ['creatorExternalId', asString(pattern.creator_id)],
      ['marketedAudience', asString(pattern.marketed_audience)],
      ['typicalPresentation', asString(pattern.typical_presentation)],
      ['audienceBasis', asString(pattern.audience_basis)],
      ['ageGroup', asString(pattern.age_group)],
      ['fit', cleanText(pattern.fit, 500)],
      ['construction', cleanText(pattern.construction, 500)],
      ['neckline', cleanText(pattern.neckline, 300)],
      ['sleeveStyle', cleanText(pattern.sleeve_style, 300)],
      ['garmentLength', cleanText(pattern.garment_length, 300)],
      ['closure', cleanText(pattern.closure, 300)],
      ['shaping', cleanText(pattern.shaping, 500)],
      ['season', cleanText(pattern.season, 300)],
      ['occasionOrUse', cleanText(pattern.occasion_or_use, 500)],
      ['reviewStatus', asString(pattern.review_status)],
      ['classificationMethod', asString(pattern.classification_method)],
      ['classificationConfidence', asString(pattern.classification_confidence)],
      ['freeVerifiedOn', asString(pattern.free_verified_on)],
      ['accessRequirement', asString(pattern.access_requirement)],
      ['timeMinimumHours', asNumber(pattern.time_min_active_hours)],
      ['timeMaximumHours', asNumber(pattern.time_max_active_hours)],
      ['timeBand', asString(pattern.time_band)],
      ['timeMethod', cleanText(pattern.time_method, 500)],
      ['timeConfidence', asString(pattern.time_confidence)],
      ['publisherPostSummary', cleanText(pattern.publisher_post_summary ?? detail?.publisher_post_summary, 1_200)],
      ['searchSummary', cleanText(pattern.search_summary ?? detail?.quick_summary, 1_000)],
    ])],
    ['sources', (related.sources.get(externalId) ?? []).map(mapSource)],
    ['sizes', sizeRows.filter((row) => row.record_type === 'Size').map(mapSize)],
    ['measurements', sizeRows.filter((row) => row.record_type === 'Measurement').map(mapMeasurement)],
    ['yarnRequirements', (related.yarns.get(externalId) ?? []).map(mapYarn)],
    ['materials', (related.materials.get(externalId) ?? []).map(mapMaterial)],
    ['gauges', (related.gauges.get(externalId) ?? []).map(mapGauge)],
    ['timeEstimates', (related.times.get(externalId) ?? []).map(mapTime)],
    ['palette', (related.palette.get(externalId) ?? []).map(mapPalette)],
    ['credits', credits],
    ['reviewItems', (related.reviews.get(externalId) ?? []).map(mapReview)],
  ])) as JsonRecord
}

function mapPatternRow(
  catalog: CatalogDocument,
  pattern: JsonRecord,
  detail: JsonRecord | undefined,
  tags: string[],
  metadata: JsonRecord,
): JsonRecord {
  return compactObject([
    ['external_id', asString(pattern.pattern_id)],
    ['catalog_code', asString(pattern.pattern_id)],
    ['title', cleanText(pattern.title, 300)],
    ['craft', cleanText(pattern.craft, 80)],
    ['category', cleanText(pattern.category, 200)],
    ['item_type', cleanText(pattern.item_type, 200)],
    ['item_subtype', cleanText(pattern.item_subtype, 200)],
    ['designer_name', cleanText(pattern.creator_name, 300)],
    ['publisher', cleanText(pattern.publisher, 300)],
    ['description', cleanText(pattern.detailed_description ?? detail?.article_or_object_description, 4_000)],
    ['source_url', firstPublicUrl(pattern, ['product_url'])],
    ['skill_level', cleanText(pattern.skill_level, 100)],
    ['yarn_weight', cleanText(pattern.yarn_weight, 200)],
    ['size_summary', cleanText(pattern.size_summary, 1_000)],
    ['free_status', cleanText(pattern.free_status, 100)],
    ['access_status', cleanText(pattern.availability, 100)],
    ['tags', tags],
    ['metadata', metadata],
    ['source_managed', true],
    ['source_updated_at', asString(catalog.generated_on) ?? new Date(0).toISOString()],
  ])
}

function mimeFromExtension(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.pdf': return 'application/pdf'
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    default: return 'application/octet-stream'
  }
}

function safeExtension(filePath: string, mimeType: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (/^\.[a-z0-9]{1,8}$/.test(extension)) return extension
  if (mimeType === 'application/pdf') return '.pdf'
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/png') return '.png'
  return '.bin'
}

function storagePathFor(householdId: string, sha256: string, extension: string): string {
  return `${householdId}/catalog/${sha256.slice(0, 2)}/${sha256}${extension}`
}

function recordPathMap(rows: JsonRecord[] | undefined): Map<string, JsonRecord> {
  const map = new Map<string, JsonRecord>()
  for (const row of rows ?? []) {
    const relativePath = asString(row.relative_path)
    if (relativePath && !map.has(relativePath.replaceAll('\\', '/'))) map.set(relativePath.replaceAll('\\', '/'), row)
  }
  return map
}

async function planAsset(
  relativePath: string,
  role: AssetRole,
  externalId: string,
  options: BuildPlanOptions,
  evidence: JsonRecord | undefined,
  byHash: Map<string, PlannedAsset>,
  patternAssets: PlannedPatternAsset[],
  issues: ImportIssue[],
): Promise<string | null> {
  if (path.extname(relativePath).toLowerCase() === '.url') return null
  let localPath: string
  try {
    localPath = resolveCatalogAsset(options.assetRoot, relativePath)
  } catch (error) {
    issues.push({ severity: 'error', code: 'unsafe_asset_path', externalId, message: error instanceof Error ? error.message : 'Unsafe asset path.' })
    return null
  }

  let fileStats
  try {
    fileStats = await stat(localPath)
    if (!fileStats.isFile()) throw new Error('Not a file')
  } catch {
    issues.push({ severity: 'error', code: 'missing_asset', externalId, message: `${role} file is missing or unreadable.` })
    return null
  }

  const sha256 = await sha256File(localPath)
  const expectedHash = asString(evidence?.sha256)?.toLowerCase()
  if (expectedHash && expectedHash !== sha256) {
    issues.push({ severity: 'error', code: 'asset_hash_mismatch', externalId, message: `${role} checksum does not match the catalog.` })
    return null
  }
  const catalogBytes = asNumber(evidence?.bytes)
  if (catalogBytes !== null && catalogBytes !== fileStats.size) {
    issues.push({ severity: 'error', code: 'asset_size_mismatch', externalId, message: `${role} byte size does not match the catalog.` })
    return null
  }

  const evidenceMime = asString(evidence?.media_type)
  const guessedMime = mimeFromExtension(relativePath)
  const mimeType = evidenceMime
    && evidenceMime !== 'application/octet-stream'
    && !evidenceMime.includes('x-mswinurl')
    ? evidenceMime
    : guessedMime
  const extension = safeExtension(relativePath, mimeType)
  let asset = byHash.get(sha256)
  if (!asset) {
    asset = {
      sha256,
      byteSize: fileStats.size,
      mimeType,
      extension,
      storagePath: storagePathFor(options.householdId, sha256, extension),
      originalName: path.basename(relativePath),
      localPath,
      roles: [],
      patternExternalIds: [],
      pageCount: asNumber(evidence?.page_count),
      language: asString(evidence?.language),
      sourceFileIds: [],
    }
    byHash.set(sha256, asset)
  }
  if (!asset.roles.includes(role)) asset.roles.push(role)
  if (!asset.patternExternalIds.includes(externalId)) asset.patternExternalIds.push(externalId)
  const sourceFileId = asString(evidence?.file_id ?? evidence?.image_id)
  if (sourceFileId && !asset.sourceFileIds.includes(sourceFileId)) asset.sourceFileIds.push(sourceFileId)
  patternAssets.push({ patternExternalId: externalId, assetSha256: sha256, role, isPrimary: role === 'primary_instructions' })
  return sha256
}

export async function buildCatalogImportPlan(catalog: CatalogDocument, options: BuildPlanOptions): Promise<CatalogImportPlan> {
  const householdId = validateHouseholdId(options.householdId)
  const includePrimary = options.includePrimary !== false
  const includeThumbnails = options.includeThumbnails !== false
  const sourceKey = options.sourceKey ?? `fiber-catalog-${asString(catalog.schema_version) ?? 'unknown'}`
  const sourceLabel = options.sourceLabel ?? 'Fiber Pattern Catalog'
  const issues: ImportIssue[] = []
  const plannedPatterns: PlannedPattern[] = []
  const patternAssets: PlannedPatternAsset[] = []
  const assetsByHash = new Map<string, PlannedAsset>()
  const seenPatternIds = new Set<string>()

  const detailByPattern = new Map<string, JsonRecord>()
  for (const detail of catalog.pattern_details ?? []) {
    const patternId = asString(detail.pattern_id)
    if (patternId && !detailByPattern.has(patternId)) detailByPattern.set(patternId, detail)
  }
  const related = {
    sources: rowsForPattern(catalog.sources),
    sizes: rowsForPattern(catalog.sizes_measurements),
    yarns: rowsForPattern(catalog.yarn_requirements),
    materials: rowsForPattern(catalog.materials),
    gauges: rowsForPattern(catalog.gauge),
    times: rowsForPattern(catalog.time_estimates),
    palette: rowsForPattern(catalog.thumbnail_palette),
    tags: rowsForPattern(catalog.pattern_tags),
    credits: rowsForPattern(catalog.pattern_credits),
    reviews: rowsForPattern(catalog.needs_review),
  }
  const creatorsById = new Map<string, JsonRecord>()
  for (const creator of catalog.creators ?? []) {
    const id = asString(creator.creator_id)
    if (id) creatorsById.set(id, creator)
  }
  const creatorLinksById = new Map<string, JsonRecord[]>()
  for (const link of catalog.creator_links ?? []) {
    const id = asString(link.creator_id)
    if (!id) continue
    creatorLinksById.set(id, [...(creatorLinksById.get(id) ?? []), link])
  }
  const filesByPath = recordPathMap(catalog.files)
  const imagesByPath = recordPathMap(catalog.screenshots_images)

  for (const pattern of catalog.patterns) {
    const externalId = asString(pattern.pattern_id)
    if (!externalId || !PATTERN_EXTERNAL_ID.test(externalId)) {
      issues.push({ severity: 'error', code: 'invalid_pattern_id', message: 'A pattern has a missing or invalid PAT external ID.' })
      continue
    }
    if (seenPatternIds.has(externalId)) {
      issues.push({ severity: 'error', code: 'duplicate_pattern_id', externalId, message: 'Duplicate PAT external ID in catalog.' })
      continue
    }
    seenPatternIds.add(externalId)
    const title = asString(pattern.title)
    const craft = asString(pattern.craft)
    if (!title || !craft) {
      issues.push({ severity: 'error', code: 'missing_required_pattern_field', externalId, message: 'Pattern title or craft is missing.' })
      continue
    }

    const tags = [...new Set([
      ...asStringArray(pattern.feature_tags),
      ...(related.tags.get(externalId) ?? []).map((row) => asString(row.tag_value)).filter((tag): tag is string => tag !== null),
    ])].sort((a, b) => a.localeCompare(b))
    const metadata = buildPatternMetadata(catalog, pattern, detailByPattern.get(externalId), related, creatorsById, creatorLinksById)
    const row = mapPatternRow(catalog, pattern, detailByPattern.get(externalId), tags, metadata)
    const privacyViolations = findPrivacyViolations(row)
    if (privacyViolations.length > 0) {
      issues.push({ severity: 'error', code: 'private_data_after_sanitization', externalId, message: 'Sanitized pattern still contains private path or signed URL data.' })
      continue
    }
    plannedPatterns.push({ externalId, importFingerprint: sha256Text(stableStringify(row)), row })

    if (includePrimary) {
      const relativePath = asString(pattern.primary_instructions_relative_path ?? pattern.primary_pdf_relative_path)
      if (relativePath) {
        const key = relativePath.replaceAll('\\', '/')
        await planAsset(relativePath, 'primary_instructions', externalId, { ...options, householdId }, filesByPath.get(key), assetsByHash, patternAssets, issues)
      } else {
        issues.push({ severity: 'warning', code: 'missing_primary_reference', externalId, message: 'Pattern does not have a primary instruction reference.' })
      }
    }
    if (includeThumbnails) {
      const relativePath = asString(pattern.thumbnail_relative_path)
      if (relativePath) {
        const key = relativePath.replaceAll('\\', '/')
        await planAsset(relativePath, 'thumbnail', externalId, { ...options, householdId }, imagesByPath.get(key) ?? filesByPath.get(key), assetsByHash, patternAssets, issues)
      } else {
        issues.push({ severity: 'warning', code: 'missing_thumbnail_reference', externalId, message: 'Pattern does not have a thumbnail reference.' })
      }
    }
  }

  const assets = [...assetsByHash.values()].sort((left, right) => left.sha256.localeCompare(right.sha256))
  for (const pattern of plannedPatterns) {
    const links = patternAssets.filter((link) => link.patternExternalId === pattern.externalId)
    pattern.importFingerprint = sha256Text(stableStringify({ row: pattern.row, assets: links.map(({ assetSha256, role }) => ({ assetSha256, role })).sort((a, b) => a.role.localeCompare(b.role)) }))
  }
  const totalAssetBytes = assets.reduce((sum, asset) => sum + asset.byteSize, 0)
  const assetsOver50MiB = assets.filter((asset) => asset.byteSize > 50 * 1024 * 1024).length
  if (assetsOver50MiB > 0) {
    issues.push({
      severity: 'warning',
      code: 'large_private_assets',
      message: `${assetsOver50MiB} private asset${assetsOver50MiB === 1 ? '' : 's'} exceed 50 MiB. Confirm the Supabase project upload limit or compress them before --apply.`,
    })
  }

  return {
    sourceKey,
    sourceLabel,
    schemaVersion: asString(catalog.schema_version) ?? 'unknown',
    catalogSha256: options.catalogSha256.toLowerCase(),
    manifestSha256: (options.manifestSha256 ?? options.catalogSha256).toLowerCase(),
    householdId,
    patterns: plannedPatterns,
    assets,
    patternAssets,
    issues,
    stats: {
      catalogPatternCount: catalog.patterns.length,
      plannedPatternCount: plannedPatterns.length,
      uniqueAssetCount: assets.length,
      primaryAssetLinks: patternAssets.filter((link) => link.role === 'primary_instructions').length,
      thumbnailAssetLinks: patternAssets.filter((link) => link.role === 'thumbnail').length,
      totalAssetBytes,
      assetsOver50MiB,
    },
  }
}

export function toSafeImportReport(plan: CatalogImportPlan, mode: 'dry-run' | 'apply', apply?: JsonRecord): SafeImportReport {
  const report: SafeImportReport = {
    schemaVersion: '1.0.0',
    mode,
    generatedAt: new Date().toISOString(),
    source: {
      sourceKey: plan.sourceKey,
      sourceLabel: plan.sourceLabel,
      catalogSchemaVersion: plan.schemaVersion,
      catalogSha256: plan.catalogSha256,
      manifestSha256: plan.manifestSha256,
    },
    destination: { householdId: plan.householdId, bucket: 'pattern-assets' },
    counts: plan.stats,
    issues: plan.issues,
    assets: plan.assets.map((asset) => ({
      sha256: asset.sha256,
      byteSize: asset.byteSize,
      mimeType: asset.mimeType,
      storagePath: asset.storagePath,
      roles: asset.roles,
      referenceCount: asset.patternExternalIds.length,
    })),
    ...(apply ? { apply: sanitizeForDatabase(apply) as JsonRecord } : {}),
  }
  const violations = findPrivacyViolations(report)
  if (violations.length > 0) throw new Error(`Safe report failed privacy validation: ${violations.join(', ')}`)
  return report
}
