import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  settingsSchema,
  type Settings,
} from '@shared/contracts'
import { isTrustedSender } from '@main/security'

describe('settings boundary', () => {
  it('provides a valid editable initial tab', () => {
    const settings = defaultSettings()
    expect(settings.tabs[0]?.id).toBe(settings.activeTabId)
    expect(settingsSchema.parse(settings)).toEqual(settings)
  })
  it('rejects secrets, oversized SQL and invalid tabs', () => {
    expect(
      settingsSchema.safeParse({ ...defaultSettings(), password: 'secret' })
        .success,
    ).toBe(false)
    expect(
      settingsSchema.safeParse({ ...defaultSettings(), tabs: [] }).success,
    ).toBe(false)
    expect(
      settingsSchema.safeParse({ ...defaultSettings(), activeTabId: 'missing' })
        .success,
    ).toBe(false)
    expect(
      settingsSchema.safeParse({
        ...defaultSettings(),
        tabs: [{ id: 'a', title: 'a', sql: 'x'.repeat(200001) }],
      }).success,
    ).toBe(false)
  })
  it('migrates old settings to separate dark/light palettes and rejects unknown choices', () => {
    const legacy: Partial<Settings> = { ...defaultSettings() }
    delete legacy.themePalettes
    expect(settingsSchema.parse(legacy).themePalettes).toEqual({
      dark: 'emerald',
      light: 'emerald',
    })
    expect(
      settingsSchema.safeParse({
        ...defaultSettings(),
        themePalettes: { dark: 'unknown', light: 'emerald' },
      }).success,
    ).toBe(false)
  })
})
describe('IPC sender gate', () => {
  const target = 'file:///C:/app/out/renderer/index.html'
  it('allows only the exact document in the main frame', () => {
    expect(isTrustedSender(target, target, true)).toBe(true)
    expect(isTrustedSender(target, target, false)).toBe(false)
    expect(isTrustedSender('https://evil.example', target, true)).toBe(false)
    expect(isTrustedSender(`${target}?other`, target, true)).toBe(false)
    expect(isTrustedSender('invalid', target, true)).toBe(false)
  })
})
