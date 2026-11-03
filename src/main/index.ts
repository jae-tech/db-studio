import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeTheme,
  session,
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { channels } from '../shared/channels'
import { SettingsStore } from './settings'
import { isTrustedSender } from './security'
import { DatabaseRepository } from './database/repository'
import { DatabaseService } from './database/service'
import { MssqlAdapter } from './database/mssql/adapter'
import { OsCredentialCipher } from './security/credentials'
import { AgentService } from './agent/service'
import { CodexAdapter } from './agent/codex'
import { CopilotAdapter } from './agent/copilot'
import { MetadataCache } from './mcp/metadata'
import { openMcpScope } from './mcp/broker'
import { MutationService } from './database/mutations'
import { z } from 'zod'
import { ImportService } from './imports/service'
import { relationshipScope } from './mcp/relationships'

z.config(z.locales.ko())
app.commandLine.appendSwitch('lang', 'ko')

let store: SettingsStore | undefined
let window: BrowserWindow | undefined
let database: DatabaseService | undefined
let repository: DatabaseRepository | undefined
let agent: AgentService | undefined
let mutations: MutationService | undefined
let imports: ImportService | undefined
let shuttingDown = false
let cleanupComplete = false
if (!app.isPackaged && app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir'))
}
const devUrl = !app.isPackaged
  ? process.env.ELECTRON_RENDERER_URL || undefined
  : undefined
const rendererUrl =
  devUrl ??
  pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#101418',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = undefined
  })
  void window
    .loadURL(rendererUrl)
    .catch((error) =>
      dialog.showErrorBox('작업 공간을 불러오지 못했습니다', String(error)),
    )
}

app
  .whenReady()
  .then(async () => {
    // Only clipboard writes (copying grid values) are allowed; reads stay blocked.
    const allowed = (permission: string) =>
      permission === 'clipboard-sanitized-write'
    session.defaultSession.setPermissionRequestHandler(
      (_contents, permission, callback) => callback(allowed(permission)),
    )
    session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
      allowed(permission),
    )
    mkdirSync(app.getPath('userData'), { recursive: true })
    store = new SettingsStore(join(app.getPath('userData'), 'preferences.db'))
    repository = new DatabaseRepository(
      join(app.getPath('userData'), 'database.db'),
      new OsCredentialCipher(),
    )
    await repository.initialize()
    database = new DatabaseService(repository, () => new MssqlAdapter())
    mutations = new MutationService(database, (entry) =>
      repository!.addHistory(entry),
    )
    imports = new ImportService(database)
    const metadataCache = new MetadataCache()
    agent = new AgentService(
      {
        codex: new CodexAdapter(
          join(app.getPath('userData'), 'agent-workspace'),
        ),
        copilot: new CopilotAdapter(
          join(app.getPath('userData'), 'agent-workspace'),
        ),
      },
      (event) => {
        if (window && !window.webContents.isDestroyed())
          window.webContents.send(channels.agentEvent, event)
      },
      (connectionId, signal, propose) => {
        return openMcpScope(
          relationshipScope(
            database!.metadataScope(connectionId),
            () => store!.get().virtualRelationships,
          ),
          metadataCache,
          signal,
          propose,
          {
            executable: process.execPath,
            script: join(import.meta.dirname, 'mcp-stdio.js'),
            electron: true,
          },
        )
      },
    )
    const trusted = (
      event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
    ) =>
      !!window &&
      event.sender === window.webContents &&
      isTrustedSender(
        event.senderFrame?.url ?? '',
        rendererUrl,
        event.senderFrame === window.webContents.mainFrame,
      )
    const register = (
      channel: string,
      handler: (input: unknown) => unknown,
    ): void => {
      ipcMain.handle(channel, (event, input: unknown) => {
        if (!trusted(event)) throw new Error('Untrusted IPC sender')
        if (!store) throw new Error('Settings store unavailable')
        return handler(input)
      })
    }
    register(channels.info, () => ({
      name: 'AI DB Studio',
      version: app.getVersion(),
      platform: process.platform,
      storage: 'sqlite',
    }))
    // Native popups (datalist, menus) follow the app theme, not the OS theme.
    const themed = <T extends { theme: 'light' | 'dark' }>(settings: T): T => {
      nativeTheme.themeSource = settings.theme
      return settings
    }
    register(channels.getSettings, () => themed(store!.get()))
    register(channels.saveSettings, (input) => themed(store!.save(input)))
    ipcMain.on(channels.saveSettingsSync, (event, input: unknown) => {
      try {
        if (!trusted(event) || !store) throw new Error('Untrusted IPC sender')
        themed(store.save(input))
        event.returnValue = {}
      } catch (error) {
        event.returnValue = {
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
    register(channels.connections, () => database!.listConnections())
    register(channels.saveConnection, (input) =>
      database!.saveConnection(input),
    )
    register(channels.deleteConnection, async (input) => {
      await mutations!.abortConnection(input)
      return database!.deleteConnection(input)
    })
    register(channels.connect, (input) => database!.connect(input))
    register(channels.disconnect, async (input) => {
      await mutations!.abortConnection(input)
      return database!.disconnect(input)
    })
    register(channels.explorer, (input) => database!.getExplorer(input))
    register(channels.describe, (input) => database!.describeTable(input))
    register(channels.review, (input) => database!.reviewQuery(input))
    register(channels.execute, (input) => database!.executeQuery(input))
    register(channels.fetchMore, (input) => database!.fetchMore(input))
    // Main owns the path: the renderer only picks a format, never a file name.
    register(channels.exportQuery, (input) =>
      database!.exportQuery(input, async (format) => {
        if (!window || shuttingDown) throw new Error('앱을 종료하는 중입니다.')
        const stamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[-:]/g, '')
          .replace('T', '-')
        const result = await dialog.showSaveDialog(window, {
          title: '결과 전체 내보내기',
          defaultPath: join(
            app.getPath('downloads'),
            `결과-${stamp}.${format}`,
          ),
          filters:
            format === 'csv'
              ? [{ name: 'CSV (UTF-8)', extensions: ['csv'] }]
              : [{ name: 'Excel 통합 문서', extensions: ['xlsx'] }],
        })
        return result.canceled ? undefined : result.filePath
      }),
    )
    register(channels.cancel, (input) => database!.cancelQuery(input))
    register(channels.history, () => database!.getHistory())
    register(channels.savedQueries, () => repository!.savedQueries())
    register(channels.saveQuery, (input) => repository!.saveQuery(input))
    register(channels.deleteSavedQuery, (input) =>
      repository!.deleteSavedQuery(input),
    )
    register(channels.mutationPreview, (input) => mutations!.preview(input))
    register(channels.mutationInspect, (input) =>
      database!.inspectMutation(input),
    )
    register(channels.mutationApply, (input) => mutations!.apply(input))
    register(channels.mutationCommit, (input) => mutations!.commit(input))
    register(channels.mutationRollback, (input) => mutations!.rollback(input))
    register(channels.mutationState, (input) => mutations!.state(input))
    register(channels.importOpen, async () => {
      if (!window || shuttingDown) throw new Error('앱을 종료하는 중입니다.')
      const result = await dialog.showOpenDialog(window, {
        title: '엑셀 파일 선택',
        filters: [{ name: 'Excel 통합 문서', extensions: ['xlsx'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return null
      return imports!.open(result.filePaths[0])
    })
    register(channels.importStage, (input) => imports!.stage(input))
    register(channels.importLoad, (input) => imports!.load(input))
    register(channels.importList, (input) => imports!.list(input))
    register(channels.importDiscard, (input) => imports!.discard(input))
    register(channels.agentStatus, () => agent!.status())
    register(channels.agentStart, (input) => agent!.start(input))
    register(channels.agentCancel, (input) => agent!.cancel(input))
    register(channels.agentReset, (input) => agent!.reset(input))
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    dialog.showErrorBox('AI DB Studio 시작 실패', String(error))
    app.quit()
  })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('will-quit', () => {
  repository?.close()
  repository = undefined
  store?.close()
  store = undefined
})
app.on('before-quit', (event) => {
  if (cleanupComplete || (!database && !agent)) return
  event.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  void (async () => {
    try {
      try {
        await imports?.dispose()
      } finally {
        await mutations?.dispose()
      }
    } finally {
      await Promise.all([database?.dispose(), agent?.dispose()])
    }
  })()
    .catch(() =>
      dialog.showErrorBox(
        '종료 정리 실패',
        '데이터베이스 트랜잭션 정리를 확인하지 못했습니다. 쓰기를 다시 시도하기 전에 서버 상태를 확인하세요.',
      ),
    )
    .finally(() => {
      cleanupComplete = true
      app.quit()
    })
})
