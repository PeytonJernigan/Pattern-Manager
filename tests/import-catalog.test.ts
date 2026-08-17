import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCatalogImportPlan,
  findPrivacyViolations,
  redactPrivateText,
  resolveCatalogAsset,
  sanitizeForDatabase,
  sanitizePublicUrl,
  stableStringify,
  toSafeImportReport,
  type CatalogDocument,
} from '../scripts/lib/catalog-import.ts'
import { parseCliOptions } from '../scripts/import-catalog.ts'

const householdId = '11111111-1111-4111-8111-111111111111'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pattern-manager-import-test-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'patterns'), { recursive: true })
  await mkdir(path.join(root, 'thumbs'), { recursive: true })
  await writeFile(path.join(root, 'patterns', 'one.pdf'), 'shared pdf bytes')
  await writeFile(path.join(root, 'patterns', 'two.pdf'), 'shared pdf bytes')
  await writeFile(path.join(root, 'thumbs', 'one.jpg'), 'thumbnail one')
  await writeFile(path.join(root, 'thumbs', 'two.jpg'), 'thumbnail two')
  return root
}

function fixtureCatalog(): CatalogDocument {
  return {
    schema_version: '2.1.0',
    generated_on: '2026-08-15',
    patterns: [
      {
        pattern_id: 'PAT-000001', title: 'First Pattern', craft: 'Crochet', category: 'Garments',
        product_url: 'https://example.com/pattern?utm_source=private&token=secret&page=2',
        primary_instructions_relative_path: 'patterns/one.pdf', thumbnail_relative_path: 'thumbs/one.jpg',
        feature_tags: ['Cardigan'], detailed_description: 'A clean imported description.',
      },
      {
        pattern_id: 'PAT-000002', title: 'Second Pattern', craft: 'Knit', category: 'Accessories',
        product_url: 'https://example.com/second',
        primary_instructions_relative_path: 'patterns/two.pdf', thumbnail_relative_path: 'thumbs/two.jpg',
        feature_tags: ['Hat'], detailed_description: 'Another imported description.',
      },
    ],
    files: [
      { file_id: 'FILE-1', relative_path: 'patterns/one.pdf', media_type: 'application/pdf', bytes: 16, page_count: 2 },
      { file_id: 'FILE-2', relative_path: 'patterns/two.pdf', media_type: 'application/pdf', bytes: 16, page_count: 2 },
    ],
    screenshots_images: [
      { image_id: 'IMG-1', relative_path: 'thumbs/one.jpg', bytes: 13 },
      { image_id: 'IMG-2', relative_path: 'thumbs/two.jpg', bytes: 13 },
    ],
    sources: [
      { source_id: 'SRC-1', pattern_id: 'PAT-000001', source_type: 'Official product page', source_url: 'https://example.com/pattern?X-Amz-Signature=secret&view=public' },
    ],
    sizes_measurements: [
      { size_id: 'SIZE-1', pattern_id: 'PAT-000001', record_type: 'Size', original_label: 'M', normalized_label: 'M' },
      { measurement_id: 'MEASURE-1', pattern_id: 'PAT-000001', record_type: 'Measurement', size_label: 'M', measurement_type: 'finished_chest', normalized_value: 101.5, normalized_unit: 'cm' },
    ],
    pattern_tags: [{ pattern_tag_id: 'TAG-1', pattern_id: 'PAT-000001', tag_value: 'Top Down' }],
  }
}

describe('catalog privacy sanitization', () => {
  it('removes signed, secret, and tracking URL parameters while retaining functional public parameters', () => {
    expect(sanitizePublicUrl('https://example.com/p?a=1&token=secret&utm_source=mail&X-Amz-Signature=signed')).toBe('https://example.com/p?a=1')
    expect(sanitizePublicUrl('file:///Y:/Private/catalog.pdf')).toBeNull()
    expect(sanitizePublicUrl('http://192.168.1.10/private.pdf')).toBeNull()
  })

  it('drops local-only fields and redacts embedded absolute paths', () => {
    const sanitized = sanitizeForDatabase({
      title: 'Safe',
      relative_path: 'private/file.pdf',
      localPath: 'C:\\Users\\Person\\also-private.pdf',
      note: 'Open C:\\Users\\Person\\private.pdf',
      source_url: 'https://example.com/item?signature=secret&id=42',
    })
    expect(sanitized).toEqual({
      title: 'Safe',
      note: 'Open [local path removed]',
      source_url: 'https://example.com/item?id=42',
    })
    expect(redactPrivateText('Y:\\Private\\pattern.pdf')).toBe('[local path removed]')
    expect(findPrivacyViolations(sanitized)).toEqual([])
    expect(findPrivacyViolations({ value: 'C:\\Users\\Person\\secret.pdf' })).not.toEqual([])
  })

  it('rejects absolute paths and traversal outside the selected asset root', async () => {
    const root = await fixtureRoot()
    expect(resolveCatalogAsset(root, 'patterns/one.pdf')).toBe(path.join(root, 'patterns', 'one.pdf'))
    expect(() => resolveCatalogAsset(root, '../outside.pdf')).toThrow(/traversal|escapes/i)
    expect(() => resolveCatalogAsset(root, '%2e%2e/outside.pdf')).toThrow(/traversal|escapes/i)
    expect(() => resolveCatalogAsset(root, 'C:\\Private\\outside.pdf')).toThrow(/relative/i)
  })
})

describe('catalog importer command safety', () => {
  const required = ['--catalog', 'catalog.json', '--asset-root', 'assets', '--household-id', householdId]

  it('is a dry-run by default and accepts an explicit --dry-run flag', () => {
    expect(parseCliOptions(required, os.tmpdir()).apply).toBe(false)
    expect(parseCliOptions([...required, '--dry-run'], os.tmpdir()).apply).toBe(false)
  })

  it('rejects contradictory apply and dry-run flags', () => {
    expect(() => parseCliOptions([...required, '--apply', '--dry-run'], os.tmpdir())).toThrow(/cannot be used together/i)
  })
})

describe('catalog import planning', () => {
  it('preserves PAT IDs, hashes assets, and deduplicates shared content', async () => {
    const root = await fixtureRoot()
    const catalog = fixtureCatalog()
    const plan = await buildCatalogImportPlan(catalog, {
      householdId,
      assetRoot: root,
      catalogSha256: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
    })

    expect(plan.patterns.map((pattern) => pattern.externalId)).toEqual(['PAT-000001', 'PAT-000002'])
    expect(plan.patterns.map((pattern) => pattern.row.external_id)).toEqual(['PAT-000001', 'PAT-000002'])
    expect(plan.patternAssets).toHaveLength(4)
    expect(plan.assets).toHaveLength(3)
    expect(plan.assets.find((asset) => asset.mimeType === 'application/pdf')?.patternExternalIds).toEqual(['PAT-000001', 'PAT-000002'])
    expect(plan.assets.filter((asset) => asset.roles.includes('thumbnail')).map((asset) => asset.mimeType)).toEqual(['image/jpeg', 'image/jpeg'])
    expect(plan.assets.every((asset) => asset.storagePath.startsWith(`${householdId}/catalog/`))).toBe(true)
    expect(plan.patterns[0]?.row.source_url).toBe('https://example.com/pattern?page=2')
    expect(findPrivacyViolations(plan.patterns[0]?.row)).toEqual([])
    expect(plan.issues).toEqual([])
  })

  it('produces the same fingerprints and storage plan on a repeated run', async () => {
    const root = await fixtureRoot()
    const catalog = fixtureCatalog()
    const options = { householdId, assetRoot: root, catalogSha256: 'c'.repeat(64) }
    const first = await buildCatalogImportPlan(catalog, options)
    const second = await buildCatalogImportPlan(catalog, options)

    expect(first.patterns.map((pattern) => pattern.importFingerprint)).toEqual(second.patterns.map((pattern) => pattern.importFingerprint))
    expect(first.assets.map((asset) => asset.sha256)).toEqual(second.assets.map((asset) => asset.sha256))
    expect(stableStringify(first.patterns.map((pattern) => pattern.row))).toBe(stableStringify(second.patterns.map((pattern) => pattern.row)))
  })

  it('creates a report with no local path or signed URL data', async () => {
    const root = await fixtureRoot()
    const plan = await buildCatalogImportPlan(fixtureCatalog(), {
      householdId,
      assetRoot: root,
      catalogSha256: createHash('sha256').update('catalog').digest('hex'),
    })
    const report = toSafeImportReport(plan, 'dry-run')
    const serialized = JSON.stringify(report)

    expect(findPrivacyViolations(report)).toEqual([])
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain('localPath')
    expect(serialized).not.toContain('secret')
    expect(report.counts.uniqueAssetCount).toBe(3)
  })
})
