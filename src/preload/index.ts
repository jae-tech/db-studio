import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { DesktopApi } from '../shared/contracts'
import { channels } from '../shared/channels'
import type { AgentEvent } from '../shared/agent'

const api: DesktopApi = {
  agent: Object.freeze({
    status: () => ipcRenderer.invoke(channels.agentStatus),
    start: (input) => ipcRenderer.invoke(channels.agentStart, input),
    cancel: (input) => ipcRenderer.invoke(channels.agentCancel, input),
    reset: (provider) => ipcRenderer.invoke(channels.agentReset, provider),
    onEvent: (listener) => {
      const receive = (
        _event: Electron.IpcRendererEvent,
        payload: AgentEvent,
      ): void => listener(payload)
      ipcRenderer.on(channels.agentEvent, receive)
      return () => {
        ipcRenderer.removeListener(channels.agentEvent, receive)
      }
    },
  } satisfies DesktopApi['agent']),
  db: Object.freeze({
    imports: Object.freeze({
      open: () => ipcRenderer.invoke(channels.importOpen),
      stage: (input) => ipcRenderer.invoke(channels.importStage, input),
      load: (input) => ipcRenderer.invoke(channels.importLoad, input),
      list: (id) => ipcRenderer.invoke(channels.importList, id),
      discard: (input) => ipcRenderer.invoke(channels.importDiscard, input),
    } satisfies DesktopApi['db']['imports']),
    mutations: Object.freeze({
      preview: (input) => ipcRenderer.invoke(channels.mutationPreview, input),
      inspect: (input) => ipcRenderer.invoke(channels.mutationInspect, input),
      apply: (input) => ipcRenderer.invoke(channels.mutationApply, input),
      commit: (input) => ipcRenderer.invoke(channels.mutationCommit, input),
      rollback: (input) => ipcRenderer.invoke(channels.mutationRollback, input),
      state: (id) => ipcRenderer.invoke(channels.mutationState, id),
    } satisfies DesktopApi['db']['mutations']),
    listConnections: () => ipcRenderer.invoke(channels.connections),
    saveConnection: (input) =>
      ipcRenderer.invoke(channels.saveConnection, input),
    deleteConnection: (id) => ipcRenderer.invoke(channels.deleteConnection, id),
    connect: (input) => ipcRenderer.invoke(channels.connect, input),
    disconnect: (id) => ipcRenderer.invoke(channels.disconnect, id),
    getExplorer: (id) => ipcRenderer.invoke(channels.explorer, id),
    describeTable: (input) => ipcRenderer.invoke(channels.describe, input),
    reviewQuery: (input) => ipcRenderer.invoke(channels.review, input),
    executeQuery: (input) => ipcRenderer.invoke(channels.execute, input),
    fetchMore: (input) => ipcRenderer.invoke(channels.fetchMore, input),
    exportQuery: (input) => ipcRenderer.invoke(channels.exportQuery, input),
    cancelQuery: (input) => ipcRenderer.invoke(channels.cancel, input),
    getHistory: () => ipcRenderer.invoke(channels.history),
    listSavedQueries: () => ipcRenderer.invoke(channels.savedQueries),
    saveQuery: (input) => ipcRenderer.invoke(channels.saveQuery, input),
    deleteSavedQuery: (id) => ipcRenderer.invoke(channels.deleteSavedQuery, id),
  } satisfies DesktopApi['db']),
  getInfo: () => ipcRenderer.invoke(channels.info),
  getSettings: () => ipcRenderer.invoke(channels.getSettings),
  saveSettings: (settings) =>
    ipcRenderer.invoke(channels.saveSettings, settings),
  saveSettingsSync: (settings) => {
    const result = ipcRenderer.sendSync(channels.saveSettingsSync, settings) as
      { error?: string } | undefined
    if (result?.error) throw new Error(result.error)
  },
  setZoom: (percent) =>
    webFrame.setZoomFactor(
      Math.min(150, Math.max(80, Number(percent) || 100)) / 100,
    ),
}
contextBridge.exposeInMainWorld('desktop', Object.freeze(api))
