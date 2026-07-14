import { useCallback, useEffect, useState } from "react"
import { CircleDollarSign, RefreshCw } from "lucide-react"
import { adminCommercialApi, type AdminAiJobRow, type AdminOrderRow, type AdminReleaseRow, type AdminWalletRow } from "@/lib/admin-commercial-api"
import styles from "./CommercialOperations.module.css"

type View = "orders" | "wallets" | "jobs" | "releases"

export function CommercialOperations({ adminKey }: { adminKey: string }) {
  const [view, setView] = useState<View>("orders")
  const [orders, setOrders] = useState<AdminOrderRow[]>([])
  const [wallets, setWallets] = useState<AdminWalletRow[]>([])
  const [jobs, setJobs] = useState<AdminAiJobRow[]>([])
  const [releases, setReleases] = useState<AdminReleaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [partial, setPartial] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      adminCommercialApi.orders(adminKey),
      adminCommercialApi.wallets(adminKey),
      adminCommercialApi.aiJobs(adminKey),
      adminCommercialApi.releases(adminKey),
    ])
    if (results[0].status === "fulfilled") setOrders(results[0].value)
    if (results[1].status === "fulfilled") setWallets(results[1].value)
    if (results[2].status === "fulfilled") setJobs(results[2].value)
    if (results[3].status === "fulfilled") setReleases(results[3].value)
    setPartial(results.some((result) => result.status === "rejected"))
    setLoading(false)
  }, [adminKey])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  return (
    <section className={`${styles.panel} industrial-panel`} aria-labelledby="commercial-operations-title">
      <header className={styles.header}><div className="section-heading"><CircleDollarSign aria-hidden="true" /><div><h2 id="commercial-operations-title">商业运维</h2><p>订单、钱包、AI Job 与 Release 只读视图，不在此处执行余额或发布状态写入。</p></div></div><button className="industrial-button industrial-button--quiet" type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" />刷新</button></header>
      {partial && <p className="status-message" role="status">部分商业运维端点暂不可用，已展示可读取的数据。</p>}
      <div className={styles.tabs} role="tablist" aria-label="商业运维视图">{(["orders", "wallets", "jobs", "releases"] as View[]).map((item) => <button type="button" key={item} role="tab" aria-selected={view === item} onClick={() => setView(item)}>{item === "orders" ? `订单 ${orders.length}` : item === "wallets" ? `钱包 ${wallets.length}` : item === "jobs" ? `AI Jobs ${jobs.length}` : `Releases ${releases.length}`}</button>)}</div>
      {loading ? <p className="empty-copy" role="status">正在加载商业运维数据…</p> : <div className={styles.tableWrap}>{view === "orders" ? <OrdersTable rows={orders} /> : view === "wallets" ? <WalletsTable rows={wallets} /> : view === "jobs" ? <JobsTable rows={jobs} /> : <ReleasesTable rows={releases} />}</div>}
    </section>
  )
}

function OrdersTable({ rows }: { rows: AdminOrderRow[] }) {
  if (!rows.length) return <p className="empty-copy">暂无订单。</p>
  return <table><thead><tr><th>时间</th><th>账户</th><th>产品</th><th>金额</th><th>状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td data-label="时间">{time(row.createdAt)}</td><td data-label="账户"><code>{row.accountId}</code></td><td data-label="产品">{row.productCode}</td><td data-label="金额">{money(row.amountCents)}</td><td data-label="状态">{row.status}</td></tr>)}</tbody></table>
}

function WalletsTable({ rows }: { rows: AdminWalletRow[] }) {
  if (!rows.length) return <p className="empty-copy">暂无钱包。</p>
  return <table><thead><tr><th>账户</th><th>Cash</th><th>Gift</th><th>可用余额</th></tr></thead><tbody>{rows.map((row) => <tr key={row.accountId}><td data-label="账户"><code>{row.accountId}</code></td><td data-label="Cash">{money(row.cashCents)}</td><td data-label="Gift">{money(row.giftCents)}</td><td data-label="可用余额">{money(row.availableCents)}</td></tr>)}</tbody></table>
}

function JobsTable({ rows }: { rows: AdminAiJobRow[] }) {
  if (!rows.length) return <p className="empty-copy">暂无 AI Job。</p>
  return <table><thead><tr><th>时间</th><th>Job</th><th>Server</th><th>操作</th><th>Provider / Model</th><th>状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td data-label="时间">{time(row.createdAt)}</td><td data-label="Job"><code>{row.id}</code></td><td data-label="Server"><code>{row.serverInstanceId}</code></td><td data-label="操作">{row.operation}</td><td data-label="Provider / Model">{row.providerId} / {row.model}</td><td data-label="状态">{row.status}{row.errorCode ? ` · ${row.errorCode}` : ""}</td></tr>)}</tbody></table>
}

function ReleasesTable({ rows }: { rows: AdminReleaseRow[] }) {
  if (!rows.length) return <p className="empty-copy">暂无 Release。</p>
  return <table><thead><tr><th>时间</th><th>Release</th><th>Transaction</th><th>Server</th><th>Draft version</th><th>状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td data-label="时间">{time(row.createdAt)}</td><td data-label="Release"><code>{row.id}</code></td><td data-label="Transaction"><code>{row.transactionId ?? "—"}</code></td><td data-label="Server"><code>{row.serverInstanceId}</code></td><td data-label="Draft version">v{row.draftVersionNumber} · <code>{row.draftVersionId}</code></td><td data-label="状态">{row.transactionStatus ?? "未创建事务"}</td></tr>)}</tbody></table>
}

const money = (cents: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100)
const time = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date) }
