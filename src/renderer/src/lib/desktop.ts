import type { DesktopApi } from '@shared/contracts'
export function desktop(): DesktopApi {
  if (!window.desktop)
    throw new Error(
      'Desktop bridge unavailable. Open the app through Electron.',
    )
  return window.desktop
}
