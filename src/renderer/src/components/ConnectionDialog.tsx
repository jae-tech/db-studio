import { tw } from '@/lib/styleClasses'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { displayMessage } from '../lib/locale'
import { useState, type FormEvent } from 'react'
import type { ConnectionProfile, ConnectionSummary } from '@shared/database'
import { Button } from './ui/button'
import { desktop } from '../lib/desktop'

export function ConnectionDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing?: ConnectionSummary
  onClose: () => void
  onSaved: () => void
}) {
  const [profile, setProfile] = useState<ConnectionProfile>(
    existing
      ? {
          id: existing.id,
          name: existing.name,
          driver: existing.driver,
          host: existing.host,
          port: existing.port,
          database: existing.database,
          username: existing.username,
          environment: existing.environment,
          readOnly: existing.readOnly,
          encrypt: true,
          trustServerCertificate: existing.trustServerCertificate,
          timeoutSeconds: existing.timeoutSeconds,
          maxRows: existing.maxRows,
        }
      : {
          id: crypto.randomUUID(),
          name: '',
          driver: 'mssql',
          host: 'localhost',
          port: 1433,
          database: '',
          username: '',
          environment: 'development',
          readOnly: true,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 1000,
        },
  )
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const change = (patch: Partial<ConnectionProfile>): void =>
    setProfile((value) => ({ ...value, ...patch }))
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await desktop().db.saveConnection({
        profile,
        password: existing && !password ? undefined : password,
      })
      setPassword('')
      onSaved()
      onClose()
    } catch (cause) {
      setError(displayMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={tw('modal-backdrop')}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
        className={tw('modal')}
      >
        <h2 id="connection-title">
          {existing ? '연결 편집' : '새 MSSQL 연결'}
        </h2>
        <p> SQL Server 인증 · TLS 암호화 · 기본 SELECT 전용 </p>
        <form
          onSubmit={(event) => {
            void save(event)
          }}
        >
          <div className={tw('form-grid')}>
            <label>
              연결 이름{' '}
              <Input
                autoFocus
                required
                maxLength={80}
                value={profile.name}
                onChange={(event) => change({ name: event.target.value })}
              />
            </label>
            <label>
              환경{' '}
              <NativeSelect
                aria-label="연결 환경"
                value={profile.environment}
                onChange={(event) =>
                  change({
                    environment: event.target
                      .value as ConnectionProfile['environment'],
                  })
                }
              >
                <option value="development"> 개발 </option>
                <option value="production"> 운영 </option>
              </NativeSelect>
            </label>
            <label>
              호스트{' '}
              <Input
                required
                value={profile.host}
                onChange={(event) => change({ host: event.target.value })}
                placeholder="예: localhost 또는 server.example.com"
              />
            </label>
            <label>
              포트{' '}
              <Input
                required
                type="number"
                min="1"
                max="65535"
                value={profile.port}
                onChange={(event) =>
                  change({ port: Number(event.target.value) })
                }
              />
            </label>
            <label>
              데이터베이스{' '}
              <Input
                required
                maxLength={128}
                value={profile.database}
                onChange={(event) => change({ database: event.target.value })}
              />
            </label>
            <label>
              사용자 이름{' '}
              <Input
                required
                autoComplete="off"
                maxLength={128}
                value={profile.username}
                onChange={(event) => change({ username: event.target.value })}
              />
            </label>
            <label>
              비밀번호{' '}
              <Input
                type="password"
                autoComplete="new-password"
                required={!existing}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  existing ? '비워 두면 저장된 비밀번호를 유지합니다' : ''
                }
              />
            </label>
            <label>
              제한 시간(초){' '}
              <Input
                required
                type="number"
                min="1"
                max="120"
                value={profile.timeoutSeconds}
                onChange={(event) =>
                  change({ timeoutSeconds: Number(event.target.value) })
                }
              />
            </label>
            <label>
              최대 행 수{' '}
              <Input
                required
                type="number"
                min="1"
                max="5000"
                value={profile.maxRows}
                onChange={(event) =>
                  change({ maxRows: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <label className={tw('checkbox-label')}>
            <input
              type="checkbox"
              aria-label="제한 쓰기 허용"
              checked={!profile.readOnly}
              onChange={(event) => change({ readOnly: !event.target.checked })}
            />
            이 연결에서 제한된 UPDATE/DELETE/INSERT를 허용합니다. 미리보기 후
            적용하며, 실제로 가능한 작업은 로그인 계정의 DB 권한을
            따릅니다.{' '}
          </label>
          <label className={tw('checkbox-label')}>
            <input
              type="checkbox"
              aria-label="서버 인증서 신뢰"
              checked={profile.trustServerCertificate}
              onChange={(event) =>
                change({ trustServerCertificate: event.target.checked })
              }
            />
            서버 인증서 신뢰 (SSMS의 Trust server certificate와 같음){' '}
          </label>
          {profile.environment === 'production' &&
            (profile.trustServerCertificate || !profile.readOnly) && (
              <p className={tw('form-note')} role="note">
                운영 연결 주의:{' '}
                {profile.trustServerCertificate &&
                  '서버 인증서를 검증하지 않아 중간자 공격을 막지 못합니다. '}
                {!profile.readOnly &&
                  '쓰기가 허용되어 계정 권한 범위에서 운영 데이터가 바뀔 수 있습니다.'}
              </p>
            )}
          {error && (
            <div role="alert" className={tw('inline-error')}>
              {error}
            </div>
          )}
          <div className={tw('modal-actions')}>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setPassword('')
                onClose()
              }}
            >
              취소{' '}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '저장 중…' : '연결 저장'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
