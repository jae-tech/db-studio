import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps the renderer stylesheet as a Tailwind entry point only', () => {
  const css = readFileSync(
    resolve('src/renderer/src/styles.css'),
    'utf8',
  ).trim()
  expect(css).toBe("@import 'tailwindcss';")
})
