import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"
import {
  BadgeCheck,
  BriefcaseBusiness,
  CircleDollarSign,
  Cloud,
  Gift,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  ReceiptText,
  Server,
  ShieldCheck,
  ShoppingCart,
  UserPlus,
  WalletCards,
} from "lucide-react"
import { ApiError, apiErrorMessage, apiRequest } from "@/lib/api-client"
import { workbenchPath } from "@/lib/app-route"
import { resolveBillingOrders, resolveWalletLedger, workbenchApi, type BillingOrderHistory, type WalletLedgerEntry } from "@/lib/workbench-api"
import {
  accountApi,
  resolveAccount,
  resolveWorkspaces,
  type AccountView,
  type BillingSummary,
  type WorkspaceSummary,
} from "@/lib/account-api"

type AuthMode = "login" | "register"

interface LegacyLicenseInfo {
  license: string
  owner: string
  enabled: boolean
  online: boolean
  expiresAt: number
  boundIps: string[]
  remainingDays: number
}

function permanentAiEnabled(summary: BillingSummary | null) {
  if (!summary) return false
  return Boolean(
    summary.permanentAi
    ?? summary.aiPermanent
    ?? summary.entitlements?.some((entitlement) => entitlement.type === "AI_EDITOR_PERMANENT"),
  )
}

function walletValues(summary: BillingSummary | null) {
  const wallet = summary?.wallet ?? summary?.balance
  return {
    cashCents: wallet?.cashCents ?? summary?.cashCents ?? 0,
    giftCents: wallet?.giftCents ?? summary?.giftCents ?? 0,
  }
}

function formatCny(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100)
}

function workspaceId(workspace: WorkspaceSummary) {
  return workspace.id ?? workspace.workspaceId ?? "unknown-workspace"
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date)
}

function formatSignedCny(cents: number) {
  const value = formatCny(Math.abs(cents))
  return cents > 0 ? `+${value}` : cents < 0 ? `-${value}` : value
}

export function PortalPage() {
  const [account, setAccount] = useState<AccountView | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([])
  const [orders, setOrders] = useState<BillingOrderHistory[]>([])
  const [booting, setBooting] = useState(true)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCommercialData = useCallback(async () => {
    setDashboardLoading(true)
    try {
      const [workspaceResponse, billingResponse, ledgerResponse, orderResponse] = await Promise.all([
        accountApi.workspaces(),
        accountApi.billingSummary(),
        workbenchApi.walletLedger().catch(() => [] as WalletLedgerEntry[]),
        workbenchApi.orderHistory().catch(() => [] as BillingOrderHistory[]),
      ])
      setWorkspaces(resolveWorkspaces(workspaceResponse))
      setBilling(billingResponse)
      setLedger(resolveWalletLedger(ledgerResponse))
      setOrders(resolveBillingOrders(orderResponse))
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  const loadSession = useCallback(async () => {
    setBooting(true)
    setError(null)
    try {
      const session = await accountApi.me()
      const nextAccount = resolveAccount(session)
      if (!nextAccount) throw new Error("账户会话响应缺少账户信息。")
      setAccount(nextAccount)
      await loadCommercialData()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setAccount(null)
        setWorkspaces([])
        setBilling(null)
        setLedger([])
        setOrders([])
      } else {
        setError(apiErrorMessage(cause, "账户控制台加载失败。"))
      }
    } finally {
      setBooting(false)
    }
  }, [loadCommercialData])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  if (booting) {
    return <main id="main-content" className="route-loading" aria-busy="true" aria-live="polite">正在检查账户会话…</main>
  }

  if (!account) {
    return (
      <main id="main-content" className="portal-shell portal-shell--guest">
        <div className="portal-guest-grid">
          <AccountAccessCard onAuthenticated={() => void loadSession()} />
          <LegacyLicenseMigrationCard />
        </div>
        {error && <p className="status-message status-message--error portal-global-status" role="alert">{error}</p>}
      </main>
    )
  }

  return (
    <AccountConsole
      account={account}
      workspaces={workspaces}
      billing={billing}
      ledger={ledger}
      orders={orders}
      loading={dashboardLoading}
      error={error}
      onRefresh={() => void loadSession()}
      onCommercialRefresh={async () => {
        setError(null)
        try {
          await loadCommercialData()
        } catch (cause) {
          setError(apiErrorMessage(cause, "控制台数据刷新失败。"))
        }
      }}
      onLogout={async () => {
        setError(null)
        try {
          await accountApi.logout()
          setAccount(null)
          setWorkspaces([])
          setBilling(null)
          setLedger([])
          setOrders([])
        } catch (cause) {
          setError(apiErrorMessage(cause, "退出登录失败。"))
        }
      }}
    />
  )
}

function AccountAccessCard({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (mode === "register") {
        await accountApi.register({ email: email.trim(), password, displayName: displayName.trim() })
      } else {
        await accountApi.login({ email: email.trim(), password })
      }
      onAuthenticated()
    } catch (cause) {
      setError(apiErrorMessage(cause, mode === "register" ? "注册失败。" : "登录失败。"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="access-card portal-access-card" aria-labelledby="account-access-title">
      <header className="access-header">
        <div className="product-mark" aria-hidden="true"><ShieldCheck /></div>
        <div>
          <p className="eyebrow">ACCOUNT CONTROL PLANE</p>
          <h1 id="account-access-title">Orryx 账户控制台</h1>
          <p>使用邮箱账户管理授权、服务器、云草稿与 AI 权益。</p>
        </div>
      </header>

      <div className="auth-mode-switch" role="group" aria-label="选择登录或注册">
        <button className={`industrial-button ${mode === "login" ? "industrial-button--primary" : "industrial-button--quiet"}`} type="button" onClick={() => { setMode("login"); setError(null) }} aria-pressed={mode === "login"}>
          <LogIn aria-hidden="true" />登录
        </button>
        <button className={`industrial-button ${mode === "register" ? "industrial-button--primary" : "industrial-button--quiet"}`} type="button" onClick={() => { setMode("register"); setError(null) }} aria-pressed={mode === "register"}>
          <UserPlus aria-hidden="true" />注册
        </button>
      </div>

      <form className="industrial-form" onSubmit={(event) => void submit(event)} aria-busy={submitting}>
        {mode === "register" && (
          <div className="field-group">
            <label htmlFor="portal-display-name">显示名称</label>
            <input id="portal-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required maxLength={80} />
          </div>
        )}
        <div className="field-group">
          <label htmlFor="portal-email">邮箱</label>
          <input id="portal-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </div>
        <div className="field-group">
          <label htmlFor="portal-password">密码</label>
          <input id="portal-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={8} />
        </div>
        {error && <p className="status-message status-message--error" role="alert" aria-live="assertive">{error}</p>}
        <button className="industrial-button industrial-button--primary" type="submit" disabled={submitting || !email.trim() || password.length < 8 || (mode === "register" && !displayName.trim())}>
          {submitting ? "正在提交…" : mode === "register" ? "创建账户" : "登录控制台"}
        </button>
      </form>
      <p className="access-footer">账户会话仅由服务端 HttpOnly Cookie 管理，浏览器存储中不会保存 session token。</p>
    </section>
  )
}

function AccountConsole({
  account,
  workspaces,
  billing,
  ledger,
  orders,
  loading,
  error,
  onRefresh,
  onCommercialRefresh,
  onLogout,
}: {
  account: AccountView
  workspaces: WorkspaceSummary[]
  billing: BillingSummary | null
  ledger: WalletLedgerEntry[]
  orders: BillingOrderHistory[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onCommercialRefresh: () => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [license, setLicense] = useState("")
  const [claiming, setClaiming] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const wallet = walletValues(billing)
  const hasPermanentAi = permanentAiEnabled(billing)

  const claim = async (event: FormEvent) => {
    event.preventDefault()
    setClaiming(true)
    setStatus(null)
    try {
      const result = await accountApi.claimLicense(license.trim())
      const messages: Record<string, string> = {
        CLAIMED: "License 已认领并关联到当前账户。",
        ALREADY_OWNED: "该 License 已属于当前账户。",
        OWNED_BY_ANOTHER_ACCOUNT: "该 License 已被其他账户认领。",
        LICENSE_NOT_FOUND_OR_INACTIVE: "License 不存在、已禁用或已过期。",
      }
      setStatus(messages[result.outcome] ?? `认领结果：${result.outcome}`)
      if (result.outcome === "CLAIMED" || result.outcome === "ALREADY_OWNED") {
        setLicense("")
        await onCommercialRefresh()
      }
    } catch (cause) {
      setStatus(apiErrorMessage(cause, "License 认领失败。"))
    } finally {
      setClaiming(false)
    }
  }

  const purchase = async () => {
    setOrdering(true)
    setStatus(null)
    try {
      const order = await accountApi.createPermanentAiOrder()
      if (!order.payUrl?.trim()) throw new Error("服务端未返回支付宝支付地址。")
      window.location.assign(order.payUrl)
    } catch (cause) {
      setStatus(apiErrorMessage(cause, "创建订单失败。"))
      setOrdering(false)
    }
  }

  return (
    <main id="main-content" className="portal-shell portal-shell--console">
      <section className="portal-panel portal-panel--wide" aria-labelledby="portal-title" aria-busy={loading}>
        <header className="portal-header">
          <div>
            <p className="eyebrow">ACCOUNT CONTROL PLANE</p>
            <h1 id="portal-title">{account.displayName}</h1>
            <p>{account.email} · {account.status ?? "ACTIVE"}</p>
          </div>
          <div className="portal-header-actions">
            <button className="industrial-button industrial-button--quiet" type="button" onClick={onRefresh} disabled={loading}>
              <RefreshCw aria-hidden="true" />刷新
            </button>
            <button className="industrial-button industrial-button--quiet" type="button" onClick={() => void onLogout()}>
              <LogOut aria-hidden="true" />退出
            </button>
          </div>
        </header>

        {error && <p className="status-message status-message--error portal-section-status" role="alert">{error}</p>}
        {status && <p className="status-message portal-section-status" role="status" aria-live="polite">{status}</p>}

        <dl className="detail-grid account-summary-grid">
          <Detail icon={<BadgeCheck />} label="永久 AI 权益">
            <span className={hasPermanentAi ? "state-success" : "state-warning"}>{hasPermanentAi ? "已激活" : "未激活"}</span>
          </Detail>
          <Detail icon={<CircleDollarSign />} label="Cash 钱包">{formatCny(wallet.cashCents)}</Detail>
          <Detail icon={<Gift />} label="Gift 钱包">{formatCny(wallet.giftCents)}</Detail>
          <Detail icon={<BriefcaseBusiness />} label="Workspace">{workspaces.length} 个</Detail>
        </dl>

        <div className="portal-control-grid">
          <section className="binding-panel" aria-labelledby="claim-title">
            <div className="section-heading"><KeyRound aria-hidden="true" /><div><h2 id="claim-title">认领 License</h2><p>把旧 License 一次性迁移到账户，不将其作为账户登录凭据。</p></div></div>
            <form className="industrial-form compact-form" onSubmit={(event) => void claim(event)}>
              <div className="field-group">
                <label htmlFor="claim-license">License Key</label>
                <input id="claim-license" value={license} onChange={(event) => setLicense(event.target.value)} autoComplete="off" spellCheck={false} required minLength={8} maxLength={128} />
              </div>
              <button className="industrial-button industrial-button--primary" type="submit" disabled={claiming || license.trim().length < 8}>
                {claiming ? "正在认领…" : "认领到当前账户"}
              </button>
            </form>
          </section>

          <section className="binding-panel purchase-panel" aria-labelledby="purchase-title">
            <div className="section-heading"><WalletCards aria-hidden="true" /><div><h2 id="purchase-title">永久 AI Editor</h2><p>固定产品 AI_PERMANENT_99，支付金额 ¥99.00。</p></div></div>
            <p className="purchase-price">¥99.00 <span>永久权益</span></p>
            <ul className="compact-list">
              <li>永久 AI Editor 使用权益</li>
              <li>含 ¥50.00 Gift 钱包额度</li>
              <li>支付宝页面由服务端签名并返回</li>
            </ul>
            <button className="industrial-button industrial-button--success" type="button" onClick={() => void purchase()} disabled={ordering || hasPermanentAi}>
              <ShoppingCart aria-hidden="true" />{hasPermanentAi ? "权益已激活" : ordering ? "正在创建订单…" : "前往支付宝支付"}
            </button>
          </section>
        </div>

        <section className="workspace-section" aria-labelledby="workspace-title">
          <div className="section-heading"><Cloud aria-hidden="true" /><div><h2 id="workspace-title">Workspace / Server Instance</h2><p>账户已认领授权对应的云工作区与服务器实例。</p></div></div>
          {loading ? (
            <p className="empty-copy" role="status">正在加载工作区…</p>
          ) : workspaces.length === 0 ? (
            <p className="empty-copy">暂无 Workspace。请先认领有效 License，并让插件注册服务器实例。</p>
          ) : (
            <div className="workspace-grid">
              {workspaces.map((workspace) => {
                const servers = workspace.serverInstances ?? workspace.servers ?? []
                const id = workspaceId(workspace)
                return (
                  <article className="workspace-card" key={id}>
                    <header><div><strong>{workspace.displayName ?? workspace.name ?? "Workspace"}</strong><code>{id}</code></div><span>{workspace.role ?? "MEMBER"}</span></header>
                    {servers.length === 0 ? <p className="empty-copy">尚无 Server Instance</p> : (
                      <ul className="server-instance-list">
                        {servers.map((instance) => (
                          <li key={instance.id}>
                            <Server aria-hidden="true" />
                            <div><strong>{instance.displayName ?? "未命名服务器"}</strong><code>{instance.id}</code><span className={instance.online ? "state-success" : ""}>{instance.online ? "在线" : instance.lastSeenAt ? `最近：${new Date(instance.lastSeenAt).toLocaleString("zh-CN")}` : "已注册"}</span></div>
                            <a className="industrial-button industrial-button--quiet server-workbench-link" href={workbenchPath(id, instance.id)}>打开工作台</a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="portal-billing-section" aria-labelledby="billing-history-title">
          <div className="section-heading"><ReceiptText aria-hidden="true" /><div><h2 id="billing-history-title">Wallet Ledger / 订单历史</h2><p>只读展示钱包变动与支付订单。若扩展端点尚未启用，这里保持空状态。</p></div></div>
          <div className="portal-billing-grid">
            <div><h3>钱包流水</h3>{loading ? <p className="empty-copy" role="status">正在加载钱包流水…</p> : ledger.length === 0 ? <p className="empty-copy">暂无钱包流水。</p> : <div className="portal-dense-table"><table><thead><tr><th>时间</th><th>类型</th><th>金额</th><th>说明</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td data-label="时间">{formatDate(entry.createdAt)}</td><td data-label="类型">{entry.type}</td><td data-label="金额" className={entry.amountCents < 0 ? "state-danger" : "state-success"}>{formatSignedCny(entry.amountCents)}</td><td data-label="说明">{entry.description ?? "—"}</td></tr>)}</tbody></table></div>}</div>
            <div><h3>订单历史</h3>{loading ? <p className="empty-copy" role="status">正在加载订单历史…</p> : orders.length === 0 ? <p className="empty-copy">暂无订单记录。</p> : <div className="portal-dense-table"><table><thead><tr><th>时间</th><th>产品</th><th>金额</th><th>状态</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id ?? order.orderId}><td data-label="时间">{formatDate(order.createdAt)}</td><td data-label="产品">{order.productCode}</td><td data-label="金额">{formatCny(order.amountCents)}</td><td data-label="状态">{order.status}</td></tr>)}</tbody></table></div>}</div>
          </div>
        </section>
      </section>
    </main>
  )
}

function LegacyLicenseMigrationCard() {
  const [license, setLicense] = useState("")
  const [info, setInfo] = useState<LegacyLicenseInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lookup = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const result = await apiRequest<LegacyLicenseInfo>("/api/license/info", {
        headers: { Authorization: `Bearer ${license.trim()}` },
      })
      setInfo(result)
    } catch (cause) {
      setError(apiErrorMessage(cause, "License 查询失败。"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="access-card migration-card" aria-labelledby="legacy-license-title">
      <header className="access-header">
        <div className="product-mark" aria-hidden="true"><KeyRound /></div>
        <div><p className="eyebrow">LEGACY MIGRATION</p><h2 id="legacy-license-title">旧 License 门户</h2><p>仅用于迁移前核对，不会保存 License，也不能替代账户会话。</p></div>
      </header>
      <form className="industrial-form" onSubmit={(event) => void lookup(event)} aria-busy={loading}>
        <div className="field-group">
          <label htmlFor="legacy-license">License Key</label>
          <input id="legacy-license" value={license} onChange={(event) => setLicense(event.target.value)} autoComplete="off" spellCheck={false} required minLength={8} />
        </div>
        {error && <p className="status-message status-message--error" role="alert">{error}</p>}
        <button className="industrial-button industrial-button--quiet" type="submit" disabled={loading || license.trim().length < 8}>{loading ? "正在查询…" : "临时查看授权"}</button>
      </form>
      {info && (
        <dl className="legacy-license-result">
          <Detail icon={<KeyRound />} label="所有者">{info.owner || "未设置"}</Detail>
          <Detail icon={<Server />} label="状态"><span className={info.enabled ? info.online ? "state-success" : "" : "state-danger"}>{!info.enabled ? "已禁用" : info.online ? "服务器在线" : "服务器离线"}</span></Detail>
          <Detail icon={<BadgeCheck />} label="有效期">{info.expiresAt === 0 ? "永久有效" : `${Math.max(0, info.remainingDays)} 天`}</Detail>
        </dl>
      )}
    </section>
  )
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <div className="detail-item"><dt>{icon}<span>{label}</span></dt><dd>{children}</dd></div>
}
