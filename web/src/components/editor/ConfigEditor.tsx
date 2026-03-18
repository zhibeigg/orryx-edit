import { useState, useMemo, useCallback, useRef } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface ConfigEditorProps {
  content: string
  onChange: (yaml: string) => void
}

type Tab = "general" | "database" | "integration" | "yaml"

export function ConfigEditor({ content, onChange }: ConfigEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("general")
  const rawRef = useRef(content)
  rawRef.current = content

  const config = useMemo(() => {
    try { return parseYaml<Record<string, unknown>>(content) }
    catch { return {} }
  }, [content])

  const save = useCallback((patch: Record<string, unknown>) => {
    const merged = { ...config, ...patch }
    try { onChange(updateYamlFromObject(rawRef.current, merged)) }
    catch { onChange(stringifyYaml(merged)) }
  }, [config, onChange])

  const db = (config.Database ?? {}) as Record<string, unknown>
  const sql = (db.sql ?? {}) as Record<string, unknown>
  const ui = (config.UI ?? {}) as Record<string, unknown>
  const lark = (config.LarkSuite ?? {}) as Record<string, unknown>
  const ai = (config.OpenAI ?? {}) as Record<string, unknown>
  const editor = (config.Editor ?? {}) as Record<string, unknown>

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "基础" },
    { id: "database", label: "数据库" },
    { id: "integration", label: "集成" },
    { id: "yaml", label: "YAML 源码" },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-border bg-background shrink-0">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={cn("px-4 py-2 text-sm border-b-2 transition-colors",
            activeTab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "general" && (
          <div className="p-4 space-y-5 max-w-2xl">
            <Section title="基础设置">
              <div className="grid grid-cols-2 gap-3">
                <Toggle label="调试模式 (Debug)" checked={!!config.Debug} onChange={(v) => save({ Debug: v })} />
                <Toggle label="禁用饥饿 (DisableHunger)" checked={!!config.DisableHunger} onChange={(v) => save({ DisableHunger: v })} />
                <Toggle label="禁用日光燃烧 (DisabledCombust)" checked={!!config.DisabledCombust} onChange={(v) => save({ DisabledCombust: v })} />
                <Toggle label="技能静默 (Silence)" checked={!!config.Silence} onChange={(v) => save({ Silence: v })} />
                <Toggle label="同步原版经验 (SyncExperience)" checked={!!config.SyncExperience} onChange={(v) => save({ SyncExperience: v })} />
              </div>
            </Section>

            <Section title="回复间隔">
              <div className="grid grid-cols-2 gap-3">
                <Field label="法力回复间隔 (tick)">
                  <NumInput value={config.ManaRegainTick as number ?? config.ManaReginTick as number ?? 20}
                    onChange={(v) => save({ ManaRegainTick: v })} />
                </Field>
                <Field label="精力回复间隔 (tick)">
                  <NumInput value={config.SpiritRegainTick as number ?? 20}
                    onChange={(v) => save({ SpiritRegainTick: v })} />
                </Field>
              </div>
            </Section>

            <Section title="技能组">
              <textarea className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md font-mono h-20 resize-y"
                value={((config.Group as string[]) ?? []).join("\n")}
                onChange={(e) => save({ Group: e.target.value.split("\n").filter(Boolean) })}
                placeholder="每行一个技能组类型" />
            </Section>

            <Section title="描述分隔符">
              <input className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                value={(config.DescriptionSplit as string) ?? ""}
                onChange={(e) => save({ DescriptionSplit: e.target.value })} />
            </Section>

            <Section title="UI 框架">
              <select className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                value={(ui.use as string) ?? "bukkit"}
                onChange={(e) => save({ UI: { ...ui, use: e.target.value } })}>
                {["bukkit", "dragoncore", "germplugin", "arcartx"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Section>

            <Section title="缓存管理">
              <select className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                value={(config.CacheManager as string) ?? "disable"}
                onChange={(e) => save({ CacheManager: e.target.value })}>
                {["disable", "redis", "broker"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Section>
          </div>
        )}

        {activeTab === "database" && (
          <div className="p-4 space-y-4 max-w-2xl">
            <Section title="数据库类型">
              <select className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                value={(db.use as string) ?? "SQLLITE"}
                onChange={(e) => save({ Database: { ...db, use: e.target.value } })}>
                {["SQLLITE", "MYSQL", "H2"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Section>

            {((db.use as string) ?? "SQLLITE") === "MYSQL" && (
              <Section title="MySQL 连接">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="主机"><StrInput value={sql.host as string} onChange={(v) => save({ Database: { ...db, sql: { ...sql, host: v } } })} placeholder="localhost" /></Field>
                  <Field label="端口"><NumInput value={sql.port as number ?? 3306} onChange={(v) => save({ Database: { ...db, sql: { ...sql, port: v } } })} /></Field>
                  <Field label="用户名"><StrInput value={sql.user as string} onChange={(v) => save({ Database: { ...db, sql: { ...sql, user: v } } })} /></Field>
                  <Field label="密码"><StrInput value={sql.password as string} onChange={(v) => save({ Database: { ...db, sql: { ...sql, password: v } } })} type="password" /></Field>
                  <Field label="数据库名"><StrInput value={sql.database as string} onChange={(v) => save({ Database: { ...db, sql: { ...sql, database: v } } })} /></Field>
                </div>
              </Section>
            )}

            {((db.use as string) ?? "SQLLITE") !== "MYSQL" && (
              <Section title="文件路径">
                <StrInput value={db.path as string ?? ""} onChange={(v) => save({ Database: { ...db, path: v } })} placeholder="data.db" />
              </Section>
            )}
          </div>
        )}

        {activeTab === "integration" && (
          <div className="p-4 space-y-5 max-w-2xl">
            <Section title="飞书文档 (LarkSuite)">
              <div className="grid grid-cols-2 gap-3">
                <Field label="AppId"><StrInput value={lark.AppId as string} onChange={(v) => save({ LarkSuite: { ...lark, AppId: v } })} /></Field>
                <Field label="AppSecret"><StrInput value={lark.AppSecret as string} onChange={(v) => save({ LarkSuite: { ...lark, AppSecret: v } })} type="password" /></Field>
                <Field label="ParentWikiToken"><StrInput value={lark.ParentWikiToken as string} onChange={(v) => save({ LarkSuite: { ...lark, ParentWikiToken: v } })} /></Field>
                <Field label="SpaceId"><StrInput value={lark.SpaceId as string} onChange={(v) => save({ LarkSuite: { ...lark, SpaceId: v } })} /></Field>
              </div>
            </Section>

            <Section title="OpenAI">
              <div className="grid grid-cols-2 gap-3">
                <Field label="API Key"><StrInput value={ai.ApiKey as string} onChange={(v) => save({ OpenAI: { ...ai, ApiKey: v } })} type="password" /></Field>
                <Field label="Base URL"><StrInput value={ai.BaseUrl as string} onChange={(v) => save({ OpenAI: { ...ai, BaseUrl: v } })} placeholder="https://api.openai.com" /></Field>
              </div>
            </Section>

            <Section title="编辑器 (Editor)">
              <Field label="License"><StrInput value={editor.License as string} onChange={(v) => save({ Editor: { ...editor, License: v } })} /></Field>
            </Section>
          </div>
        )}

        {activeTab === "yaml" && (
          <div className="h-full">
            <Editor height="100%" defaultLanguage="yaml" value={content} onChange={(v) => onChange(v ?? "")} theme="vs-dark"
              options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 } }} />
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-2"><h3 className="text-sm font-semibold border-b border-border pb-1">{title}</h3>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>
}
function StrInput({ value, onChange, placeholder, type = "text" }: { value?: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input type={type} className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
}
function NumInput({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  return <input type="number" className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded" value={value ?? 0} onChange={(e) => onChange(parseInt(e.target.value) || 0)} />
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />{label}</label>
}
