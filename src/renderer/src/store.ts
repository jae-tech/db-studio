import { create } from 'zustand'
import { defaultSettings, type Settings } from '@shared/contracts'
import { formatSql } from '@shared/sqlFormatting'
type WorkspaceStore = {
  settings: Settings
  hydrated: boolean
  notice: string
  hydrate: (settings: Settings) => void
  update: (patch: Partial<Settings>) => void
  newTab: () => void
  openProposal: (sql: string, connectionId: string, title?: string) => void
  closeTab: (id: string) => void
  renameTab: (id: string, title: string) => void
  edit: (sql: string) => void
  bindConnection: (id: string | undefined) => void
  notify: (message: string) => void
}
export const useWorkspace = create<WorkspaceStore>((set) => ({
  settings: defaultSettings(),
  hydrated: false,
  notice: '작업 공간이 준비되었습니다. 데이터베이스에 연결하세요.',
  hydrate: (settings) => set({ settings, hydrated: true }),
  update: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  newTab: () =>
    set((state) => {
      if (state.settings.tabs.length >= 30)
        return { notice: 'SQL 탭은 최대 30개까지 열 수 있습니다.' }
      const id = crypto.randomUUID()
      return {
        settings: {
          ...state.settings,
          activeTabId: id,
          tabs: [
            ...state.settings.tabs,
            {
              id,
              title: `쿼리 ${state.settings.tabs.length + 1}`,
              sql: '-- SQL을 작성하세요\n',
            },
          ],
        },
      }
    }),
  openProposal: (sql, connectionId, title = 'AI 제안 · 검토 필요') =>
    set((state) => {
      if (state.settings.tabs.length >= 30)
        return { notice: 'SQL 탭은 최대 30개까지 열 수 있습니다.' }
      const id = crypto.randomUUID()
      let formatted = sql,
        warning = ''
      try {
        formatted = formatSql(sql, state.settings.sqlFormatting)
      } catch {
        warning = 'SQL 정리에 실패해 원문을 열었습니다. 구문을 확인하세요.'
      }
      return {
        settings: {
          ...state.settings,
          activeTabId: id,
          tabs: [
            ...state.settings.tabs,
            { id, title, sql: formatted, connectionId },
          ],
        },
        notice:
          warning ||
          'AI 제안을 열었습니다. SQL을 확인한 뒤 실행하세요. 쓰기는 별도 승인이 필요합니다.',
      }
    }),
  closeTab: (id) =>
    set((state) => {
      if (state.settings.tabs.length === 1)
        return { notice: 'SQL 탭을 하나 이상 열어 두어야 합니다.' }
      const tabs = state.settings.tabs.filter((tab) => tab.id !== id)
      return {
        settings: {
          ...state.settings,
          tabs,
          activeTabId:
            state.settings.activeTabId === id
              ? tabs[0]!.id
              : state.settings.activeTabId,
        },
      }
    }),
  // Blank names keep the previous title; the settings schema caps titles at 80 characters.
  renameTab: (id, title) =>
    set((state) => {
      const name = title.trim().slice(0, 80)
      if (!name) return {}
      return {
        settings: {
          ...state.settings,
          tabs: state.settings.tabs.map((tab) =>
            tab.id === id ? { ...tab, title: name } : tab,
          ),
        },
      }
    }),
  edit: (sql) =>
    set((state) => ({
      settings: {
        ...state.settings,
        tabs: state.settings.tabs.map((tab) =>
          tab.id === state.settings.activeTabId ? { ...tab, sql } : tab,
        ),
      },
    })),
  bindConnection: (connectionId) =>
    set((state) => ({
      settings: {
        ...state.settings,
        tabs: state.settings.tabs.map((tab) =>
          tab.id === state.settings.activeTabId
            ? { ...tab, connectionId }
            : tab,
        ),
      },
    })),
  notify: (notice) => set({ notice }),
}))
