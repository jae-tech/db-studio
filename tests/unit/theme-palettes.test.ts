import { describe, expect, it } from 'vitest'
import { paletteOptions, themePalettes } from '@/lib/themePalettes'

function contrast(first: string, second: string): number {
  const luminance = (hex: string): number => {
    const digits = hex.replace('#', '')
    const expanded =
      digits.length === 3
        ? [...digits].map((value) => value + value).join('')
        : digits
    const [red, green, blue] = expanded.match(/../g)!.map((value) => {
      const channel = parseInt(value, 16) / 255
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    })
    return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

describe('theme palettes', () => {
  it('keeps readable text and accent contrast on every surface', () => {
    for (const mode of ['dark', 'light'] as const)
      for (const { id } of paletteOptions) {
        const colors = themePalettes[mode][id]
        for (const surface of ['--bg', '--panel', '--raised'] as const)
          for (const ink of ['--text', '--sub', '--muted', '--accent'] as const)
            expect(
              contrast(colors[ink], colors[surface]),
              `${mode}/${id}: ${ink} on ${surface}`,
            ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrast(colors['--on-accent'], colors['--accent']),
          `${mode}/${id}: button text on accent`,
        ).toBeGreaterThanOrEqual(4.5)
      }
  })
})
