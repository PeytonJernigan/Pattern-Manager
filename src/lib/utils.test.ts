import { describe, expect, it } from 'vitest'
import { clamp, safeExternalUrl } from './utils'

describe('safeExternalUrl', () => {
  it('allows normal public web links', () => {
    expect(safeExternalUrl('https://www.ravelry.com/patterns/example')).toBe('https://www.ravelry.com/patterns/example')
  })

  it('blocks executable and local file schemes', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('file:///Y:/private/pattern.pdf')).toBeNull()
  })
})

describe('clamp', () => {
  it('keeps viewer coordinates inside their normalized range', () => {
    expect(clamp(-0.2, 0, 1)).toBe(0)
    expect(clamp(0.42, 0, 1)).toBe(0.42)
    expect(clamp(3, 0, 1)).toBe(1)
  })
})
