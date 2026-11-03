import { beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(),
  encryptStringAsync: vi.fn(),
  decryptStringAsync: vi.fn(),
  getSelectedStorageBackend: vi.fn(() => 'unknown'),
}))
vi.mock('electron', () => ({ safeStorage: storage }))
import { OsCredentialCipher } from '@main/security/credentials'
beforeEach(() => vi.resetAllMocks())
describe('OS encryption fail-closed policy', () => {
  it('does not save plaintext when the OS encryption service is unavailable', async () => {
    storage.isAsyncEncryptionAvailable.mockResolvedValue(false)
    const cipher = new OsCredentialCipher()
    await expect(cipher.encrypt('secret')).rejects.toThrow('unavailable')
    await expect(cipher.decrypt(Buffer.from('cipher'))).rejects.toThrow(
      'unavailable',
    )
    expect(storage.encryptStringAsync).not.toHaveBeenCalled()
    expect(storage.decryptStringAsync).not.toHaveBeenCalled()
  })
  it('uses async OS APIs and never falls back after encryption failure', async () => {
    storage.isAsyncEncryptionAvailable.mockResolvedValue(true)
    storage.encryptStringAsync.mockRejectedValueOnce(new Error('OS refused'))
    const cipher = new OsCredentialCipher()
    await expect(cipher.encrypt('secret')).rejects.toThrow('OS refused')
    storage.encryptStringAsync.mockResolvedValue(Buffer.from('encrypted'))
    storage.decryptStringAsync.mockResolvedValue({
      result: 'secret',
      shouldReEncrypt: false,
    })
    expect(await cipher.encrypt('secret')).toEqual(Buffer.from('encrypted'))
    expect(await cipher.decrypt(Buffer.from('encrypted'))).toBe('secret')
  })
})
