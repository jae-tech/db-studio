import { tw } from '@/lib/styleClasses'
import { NativeSelect } from '@/components/ui/native-select'
import { useEffect } from 'react'
import { Bot } from 'lucide-react'
import type { AgentProvider } from '@shared/agent'
import { useWorkspace } from '../store'
import { agentAuthLabels, displayMessage } from '../lib/locale'
import { modelOptions, providerNames, useAgentStatus } from '../lib/agentModels'
import { Button } from './ui/button'

/** Left-menu AI view: CLI status per provider, default model and the active assistant. */
export function AiSettingsView() {
  const { settings, update } = useWorkspace()
  const status = useAgentStatus()
  useEffect(() => {
    if (!status.data && !status.isFetching) void status.refetch()
  }, [])
  const setModel = (provider: AgentProvider, model: string): void => {
    const models = { ...settings.agentModels }
    if (model) models[provider] = model
    else delete models[provider]
    update({ agentModels: models })
  }
  return (
    <section className={tw('ai-settings')} aria-label="AI 설정">
      <h2>
        <Bot size={18} /> AI 설정
      </h2>
      <Button
        variant="outline"
        aria-label="AI CLI 다시 확인"
        disabled={status.isFetching}
        onClick={() => {
          void status.refetch()
        }}
      >
        {status.isFetching ? '확인 중…' : 'AI CLI 다시 확인'}
      </Button>
      {status.error && (
        <p role="alert">CLI 상태를 확인하지 못했습니다. 다시 시도하세요.</p>
      )}
      {(['codex', 'copilot'] as const).map((provider) => {
        const entry = status.data?.find((item) => item.provider === provider)
        const active = settings.provider === provider
        return (
          <article
            key={provider}
            className={tw(`ai-provider ${active ? 'selected' : ''}`)}
            aria-label={providerNames[provider]}
          >
            <header>
              <strong>{providerNames[provider]}</strong>
              {active ? (
                <small>대화에 사용 중</small>
              ) : (
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => update({ provider })}
                >
                  이 AI로 대화
                </Button>
              )}
            </header>
            <p role="note">
              {entry
                ? `${entry.version ? `CLI ${entry.version} · ` : ''}${agentAuthLabels[entry.auth]} · ${displayMessage(entry.reason)}`
                : '아직 확인하지 않았습니다.'}
            </p>
            <label>
              기본 모델
              <NativeSelect
                aria-label={`${providerNames[provider]} 기본 모델`}
                value={settings.agentModels[provider] ?? ''}
                onChange={(event) => setModel(provider, event.target.value)}
              >
                <option value="">CLI 기본 모델</option>
                {modelOptions(
                  entry?.models,
                  settings.agentModels[provider],
                ).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </article>
        )
      })}
    </section>
  )
}
