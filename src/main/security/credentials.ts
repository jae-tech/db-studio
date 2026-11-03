import { safeStorage } from 'electron'

export interface CredentialCipher {
  encrypt(plainText: string): Promise<Buffer>
  decrypt(cipherText: Buffer): Promise<string>
}
export class OsCredentialCipher implements CredentialCipher {
  private async ensureAvailable(): Promise<void> {
    if (
      !(await safeStorage.isAsyncEncryptionAvailable()) ||
      (process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')
    ) {
      throw new Error(
        'OS credential encryption is unavailable. No credentials were saved.',
      )
    }
  }
  async encrypt(plainText: string): Promise<Buffer> {
    await this.ensureAvailable()
    return safeStorage.encryptStringAsync(plainText)
  }
  async decrypt(cipherText: Buffer): Promise<string> {
    await this.ensureAvailable()
    return (await safeStorage.decryptStringAsync(cipherText)).result
  }
}
