import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js"
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"
import "monaco-editor/esm/vs/language/json/monaco.contribution.js"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"

/**
 * 使用随 Editor 构建发布的 Monaco，避免运行时依赖 jsDelivr 等外部 CDN。
 * 当前编辑器只需要基础文本、YAML/INI 与 JSON worker；Kether 语言由 ActionsEditor 注册。
 */
globalThis.MonacoEnvironment = {
  ...globalThis.MonacoEnvironment,
  getWorker: (_workerId, label) => label === "json" ? new jsonWorker() : new editorWorker(),
}

loader.config({ monaco })
