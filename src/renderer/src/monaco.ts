import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/languages/definitions/sql/register.js'
// editor.api ships without contributions; the suggest widget is needed for Ctrl+Space/"." completion.
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import {
  paletteOptions,
  sqlEditorTheme,
  themePalettes,
} from './lib/themePalettes'
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })
for (const mode of ['dark', 'light'] as const)
  for (const { id } of paletteOptions) {
    const colors = themePalettes[mode][id]
    monaco.editor.defineTheme(sqlEditorTheme(mode, id), {
      base: mode === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': colors['--editor'],
        'editor.foreground': colors['--text'],
        'editorGutter.background': colors['--editor'],
        'editorLineNumber.foreground': colors['--muted'],
        'editorCursor.foreground': colors['--accent'],
        'editor.selectionBackground': `${colors['--accent']}33`,
        'editor.lineHighlightBackground': colors['--raised'],
        'editorWidget.background': colors['--panel'],
        'editorWidget.foreground': colors['--text'],
        'editorWidget.border': colors['--border'],
        'editorSuggestWidget.background': colors['--panel'],
        'editorSuggestWidget.foreground': colors['--text'],
        'editorSuggestWidget.border': colors['--border'],
        'editorSuggestWidget.selectedBackground': colors['--raised'],
      },
    })
  }
