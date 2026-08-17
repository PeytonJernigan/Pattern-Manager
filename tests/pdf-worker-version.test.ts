import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  version: string
  dependencies?: Record<string, string>
}

async function readPackage(relativePath: string): Promise<PackageJson> {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8')) as PackageJson
}

describe('PDF.js worker compatibility', () => {
  it('pins the bundled worker to React-PDF\'s PDF.js API version', async () => {
    const [pdfJs, reactPdf] = await Promise.all([
      readPackage('../node_modules/pdfjs-dist/package.json'),
      readPackage('../node_modules/react-pdf/package.json'),
    ])

    expect(pdfJs.version).toBe(reactPdf.dependencies?.['pdfjs-dist'])
  })
})
