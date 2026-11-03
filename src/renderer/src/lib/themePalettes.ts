import type { PaletteId, Settings } from '@shared/contracts'

export type ThemeMode = Settings['theme']
export type ThemeColors = Record<
  | '--on-accent'
  | '--bg'
  | '--panel'
  | '--raised'
  | '--border'
  | '--text'
  | '--sub'
  | '--muted'
  | '--accent'
  | '--editor',
  string
>

export const paletteOptions: { id: PaletteId; label: string }[] = [
  { id: 'emerald', label: '에메랄드' },
  { id: 'ocean', label: '오션' },
  { id: 'violet', label: '바이올렛' },
  { id: 'amber', label: '앰버' },
]

export const themePalettes: Record<
  ThemeMode,
  Record<PaletteId, ThemeColors>
> = {
  dark: {
    emerald: {
      '--on-accent': '#092b23',
      '--bg': '#10151a',
      '--panel': '#151c22',
      '--raised': '#1b242c',
      '--border': '#28333c',
      '--text': '#e3eaf0',
      '--sub': '#b0bec8',
      '--muted': '#9aaab6',
      '--accent': '#62d4b7',
      '--editor': '#1e1e1e',
    },
    ocean: {
      '--on-accent': '#082333',
      '--bg': '#0c1724',
      '--panel': '#122131',
      '--raised': '#1b3043',
      '--border': '#2b475d',
      '--text': '#e5f1f8',
      '--sub': '#b6ccd9',
      '--muted': '#9db7c9',
      '--accent': '#75c7f0',
      '--editor': '#12202d',
    },
    violet: {
      '--on-accent': '#27143b',
      '--bg': '#171421',
      '--panel': '#201b2c',
      '--raised': '#2c2639',
      '--border': '#3f344d',
      '--text': '#f0eaf7',
      '--sub': '#c8bad7',
      '--muted': '#b7a7cb',
      '--accent': '#c4a5ff',
      '--editor': '#1c1826',
    },
    amber: {
      '--on-accent': '#392408',
      '--bg': '#1a1712',
      '--panel': '#242017',
      '--raised': '#30291d',
      '--border': '#483b28',
      '--text': '#f5efe3',
      '--sub': '#d4c7b3',
      '--muted': '#c0ae92',
      '--accent': '#f2be6f',
      '--editor': '#1d1a14',
    },
  },
  light: {
    emerald: {
      '--on-accent': '#ffffff',
      '--bg': '#ffffff',
      '--panel': '#f6f8fa',
      '--raised': '#edf1f4',
      '--border': '#dce3e8',
      '--text': '#1d2d38',
      '--sub': '#455966',
      '--muted': '#506574',
      '--accent': '#08775f',
      '--editor': '#ffffff',
    },
    ocean: {
      '--on-accent': '#ffffff',
      '--bg': '#f8fbff',
      '--panel': '#edf4fa',
      '--raised': '#e2edf7',
      '--border': '#cbdae8',
      '--text': '#1b3042',
      '--sub': '#3e586f',
      '--muted': '#4d667c',
      '--accent': '#166b9a',
      '--editor': '#ffffff',
    },
    violet: {
      '--on-accent': '#ffffff',
      '--bg': '#fcfaff',
      '--panel': '#f3eefb',
      '--raised': '#eae2f6',
      '--border': '#d9c9e9',
      '--text': '#30233e',
      '--sub': '#604e70',
      '--muted': '#6c587d',
      '--accent': '#7645a6',
      '--editor': '#ffffff',
    },
    amber: {
      '--on-accent': '#ffffff',
      '--bg': '#fffdf8',
      '--panel': '#faf3e8',
      '--raised': '#f5e9d6',
      '--border': '#e6d7be',
      '--text': '#3b2c1b',
      '--sub': '#685139',
      '--muted': '#765c3f',
      '--accent': '#8b5b16',
      '--editor': '#ffffff',
    },
  },
}

export const sqlEditorTheme = (mode: ThemeMode, palette: PaletteId): string =>
  `studio-${mode}-${palette}`
