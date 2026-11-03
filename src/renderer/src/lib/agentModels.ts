import { useQuery } from '@tanstack/react-query'
import type { AgentProvider } from '@shared/agent'
import { desktop } from './desktop'

export const providerNames: Record<AgentProvider, string> = {
  codex: 'Codex (ChatGPT)',
  copilot: 'GitHub Copilot',
}
// One status cache shared by the chat panel and the AI settings view.
// Checking only runs the CLIs' version/help/login checks; it never calls a model.
export function useAgentStatus() {
  return useQuery({
    queryKey: ['agent-status'],
    queryFn: () => desktop().agent.status(),
    enabled: false,
    staleTime: Infinity,
    retry: false,
  })
}
// CLI catalog first; a saved choice the CLI no longer lists is kept so it stays selectable.
export function modelOptions(
  catalog: string[] | undefined,
  saved: string | undefined,
): string[] {
  const list = [...(catalog ?? [])]
  if (saved && !list.includes(saved)) list.unshift(saved)
  return list
}
