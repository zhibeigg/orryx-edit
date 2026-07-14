import { useCallback, useEffect, useState } from "react"
import { Bot, CircleAlert, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { apiErrorMessage } from "@/lib/api-client"
import {
  adminCommercialApi,
  providerUpdateDto,
  type AdminAiProvider,
  type AdminAiProviderModel,
} from "@/lib/admin-commercial-api"
import styles from "./CommercialOperations.module.css"

export function ProviderManagement({ adminKey }: { adminKey: string }) {
  const [providers, setProviders] = useState<AdminAiProvider[]>([])
  const [drafts, setDrafts] = useState<Record<string, AdminAiProvider>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await adminCommercialApi.providers(adminKey)
      setProviders(response)
      setDrafts(Object.fromEntries(response.map((provider) => [provider.id, provider])))
    } catch (cause) {
      setError(apiErrorMessage(cause, "Provider 配置加载失败。"))
    } finally {
      setLoading(false)
    }
  }, [adminKey])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  const updateDraft = (id: string, patch: Partial<AdminAiProvider>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } as AdminAiProvider }))
  }

  const updateModel = (providerId: string, index: number, patch: Partial<AdminAiProviderModel>) => {
    const provider = drafts[providerId]
    if (!provider) return
    const models = provider.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model)
    updateDraft(providerId, { models })
  }

  const addModel = (providerId: string) => {
    const provider = drafts[providerId]
    if (!provider) return
    const existing = new Set(provider.models.map((model) => model.id))
    let suffix = provider.models.length + 1
    while (existing.has(`model-${suffix}`)) suffix += 1
    updateDraft(providerId, {
      models: [...provider.models, { id: `model-${suffix}`, inputCentsPerMillion: 0, outputCentsPerMillion: 0, cachedInputCentsPerMillion: 0 }],
    })
  }

  const removeModel = (providerId: string, index: number) => {
    const provider = drafts[providerId]
    if (!provider || provider.models.length <= 1) return
    const models = provider.models.filter((_, modelIndex) => modelIndex !== index)
    updateDraft(providerId, {
      models,
      defaultModel: models.some((model) => model.id === provider.defaultModel) ? provider.defaultModel : models[0].id,
    })
  }

  const save = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    if (!draft.models.length || draft.models.some((model) => !model.id.trim())) {
      setError("Provider 至少需要一个具有有效 ID 的模型。")
      return
    }
    if (new Set(draft.models.map((model) => model.id)).size !== draft.models.length) {
      setError("模型 ID 不能重复。")
      return
    }
    if (!draft.models.some((model) => model.id === draft.defaultModel)) {
      setError("默认模型必须存在于模型列表。")
      return
    }

    setSavingId(id)
    setError(null)
    setMessage(null)
    try {
      const saved = await adminCommercialApi.updateProvider(adminKey, id, providerUpdateDto(draft))
      setProviders((current) => current.map((provider) => provider.id === id ? saved : provider))
      setDrafts((current) => ({ ...current, [id]: saved }))
      setMessage(saved.restartRequired
        ? `${saved.displayName} 的动态配置已保存；Provider 类型或 Base URL 需同步修改启动环境并重启。`
        : `${saved.displayName} 的启停、模型与价格配置已保存。`)
    } catch (cause) {
      setError(apiErrorMessage(cause, "Provider 配置保存失败。"))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className={`${styles.panel} industrial-panel`} aria-labelledby="provider-management-title">
      <header className={styles.header}>
        <div className="section-heading"><Bot aria-hidden="true" /><div><h2 id="provider-management-title">AI Provider 管理</h2><p>热更新启停、模型与计价。API key/secret 只由启动环境或密钥管理注入，不会由前端读取、显示或提交。</p></div></div>
        <button className="industrial-button industrial-button--quiet" type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" />刷新</button>
      </header>
      {error && <p className="status-message status-message--error" role="alert">{error}</p>}
      {message && <p className="status-message status-message--success" role="status" aria-live="polite">{message}</p>}
      {loading ? <p className="empty-copy" role="status">正在加载 Provider 配置…</p> : providers.length === 0 ? (
        <div className={styles.empty}><CircleAlert aria-hidden="true" /><div><strong>暂无 Provider 配置</strong><p>请先在服务端启动环境中配置 Provider client 与凭据。</p></div></div>
      ) : (
        <div className={styles.providerList}>
          {providers.map((provider) => {
            const draft = drafts[provider.id] ?? provider
            return (
              <form key={provider.id} className={styles.providerForm} onSubmit={(event) => { event.preventDefault(); void save(provider.id) }}>
                <header>
                  <div><strong>{provider.displayName}</strong><code>{provider.id} · {provider.providerType}</code></div>
                  <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(provider.id, { enabled: event.target.checked })} /><span>{draft.enabled ? "已启用" : "已禁用"}</span></label>
                </header>
                <div className={styles.providerFields}>
                  <div className="field-group"><label htmlFor={`provider-name-${provider.id}`}>显示名称</label><input id={`provider-name-${provider.id}`} value={draft.displayName} onChange={(event) => updateDraft(provider.id, { displayName: event.target.value })} /></div>
                  <div className="field-group"><label htmlFor={`provider-type-${provider.id}`}>Provider 类型</label><input id={`provider-type-${provider.id}`} value={draft.providerType} onChange={(event) => updateDraft(provider.id, { providerType: event.target.value })} /><small>变更只做重启提示，不热替换 client。</small></div>
                  <div className="field-group"><label htmlFor={`provider-base-${provider.id}`}>Base URL</label><input id={`provider-base-${provider.id}`} type="url" value={draft.baseUrl} onChange={(event) => updateDraft(provider.id, { baseUrl: event.target.value })} /><small>需同步修改服务端启动环境后重启。</small></div>
                  <div className="field-group"><label htmlFor={`provider-default-${provider.id}`}>默认模型</label><select id={`provider-default-${provider.id}`} value={draft.defaultModel} onChange={(event) => updateDraft(provider.id, { defaultModel: event.target.value })}>{draft.models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select></div>
                </div>
                <section className={styles.modelEditor} aria-label={`${provider.displayName} 模型与价格`}>
                  <div className={styles.modelHeader}><div><strong>模型与价格</strong><span>单位：分 / 百万 token</span></div><button className="industrial-button industrial-button--quiet" type="button" onClick={() => addModel(provider.id)}><Plus aria-hidden="true" />添加模型</button></div>
                  <div className={styles.modelTable}>
                    <div className={styles.modelLabels} aria-hidden="true"><span>Model ID</span><span>Input</span><span>Output</span><span>Cached input</span><span>操作</span></div>
                    {draft.models.map((model, index) => (
                      <div className={styles.modelRow} key={`${provider.id}:${index}`}>
                        <label><span>Model ID</span><input value={model.id} maxLength={128} onChange={(event) => updateModel(provider.id, index, { id: event.target.value.trim() })} /></label>
                        <label><span>Input</span><input type="number" min="0" step="1" value={model.inputCentsPerMillion} onChange={(event) => updateModel(provider.id, index, { inputCentsPerMillion: nonNegative(event.target.value) })} /></label>
                        <label><span>Output</span><input type="number" min="0" step="1" value={model.outputCentsPerMillion} onChange={(event) => updateModel(provider.id, index, { outputCentsPerMillion: nonNegative(event.target.value) })} /></label>
                        <label><span>Cached input</span><input type="number" min="0" step="1" value={model.cachedInputCentsPerMillion} onChange={(event) => updateModel(provider.id, index, { cachedInputCentsPerMillion: nonNegative(event.target.value) })} /></label>
                        <button className="industrial-button industrial-button--danger-quiet" type="button" disabled={draft.models.length <= 1} onClick={() => removeModel(provider.id, index)} aria-label={`删除模型 ${model.id || index + 1}`}><Trash2 aria-hidden="true" /></button>
                      </div>
                    ))}
                  </div>
                </section>
                <footer><span>{draft.restartRequired ? "上次响应提示需要重启" : `最后更新 ${formatTime(draft.updatedAt)}`}</span><button className="industrial-button industrial-button--primary" type="submit" disabled={savingId === provider.id}><Save aria-hidden="true" />{savingId === provider.id ? "正在保存…" : "保存非敏感配置"}</button></footer>
              </form>
            )
          })}
        </div>
      )}
    </section>
  )
}

function nonNegative(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date)
}
