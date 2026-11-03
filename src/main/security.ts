export function isTrustedSender(
  senderUrl: string,
  expectedUrl: string,
  isMainFrame: boolean,
): boolean {
  if (!isMainFrame) return false
  try {
    const actual = new URL(senderUrl)
    const expected = new URL(expectedUrl)
    return actual.href === expected.href
  } catch {
    return false
  }
}
