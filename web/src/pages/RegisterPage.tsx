import { useEffect, useState } from "react"
import { ArrowLeft, BadgeCheck, FileCheck2, LockKeyhole, ServerCog } from "lucide-react"
import { AccountAuthForm } from "@/components/AccountAuthForm"
import { BrandMark } from "@/components/BrandMark"
import { ApiError, apiErrorMessage } from "@/lib/api-client"
import { accountApi, resolveAccount, type AccountView } from "@/lib/account-api"

export function RegisterPage() {
  const [checking, setChecking] = useState(true)
  const [account, setAccount] = useState<AccountView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    accountApi.me()
      .then((session) => {
        if (active) setAccount(resolveAccount(session))
      })
      .catch((cause) => {
        if (active && !(cause instanceof ApiError && cause.status === 401)) {
          setError(apiErrorMessage(cause, "无法检查当前账户会话。你仍可稍后重试。"))
        }
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => { active = false }
  }, [])

  if (checking) {
    return <main id="main-content" className="route-loading" aria-busy="true" aria-live="polite">正在检查账户会话…</main>
  }

  return (
    <main id="main-content" className="register-shell">
      <header className="register-header">
        <a className="brand-link" href="/" aria-label="返回 Orryx 插件门户首页">
          <BrandMark className="brand-mark" />
          <span><strong>ORRYX</strong><small>ACCOUNT REGISTRATION</small></span>
        </a>
        <a className="register-back-link" href="/"><ArrowLeft aria-hidden="true" />返回插件门户</a>
      </header>

      <div className="register-layout">
        <section className="register-form-panel" aria-labelledby="register-title">
          <p className="home-kicker"><span aria-hidden="true" />ACCOUNT CONTROL PLANE</p>
          <h1 id="register-title">创建 Orryx 账户</h1>
          <p className="register-lead">用一个账户管理 License、服务器实例、云草稿、审核发布与 AI Editor 权益。</p>

          {account ? (
            <div className="register-session-state" role="status">
              <BadgeCheck aria-hidden="true" />
              <div>
                <strong>当前已登录为 {account.displayName}</strong>
                <p>{account.email}</p>
                <a className="industrial-button industrial-button--primary" href="/portal">进入账户控制台</a>
              </div>
            </div>
          ) : (
            <AccountAuthForm mode="register" onAuthenticated={() => window.location.replace("/portal")} />
          )}
          {error && <p className="status-message status-message--error register-session-error" role="alert" aria-live="assertive">{error}</p>}
          {!account && <p className="auth-route-link">已有账户？<a href="/portal">登录 Portal</a></p>}
        </section>

        <aside className="register-context" aria-label="账户功能说明">
          <div className="register-context__command">
            <span>FIRST SERVER LINK</span>
            <code>/orryx edit</code>
            <small>注册后仍由游戏内玩家发起安全连接</small>
          </div>
          <ol>
            <li><span>01</span><ServerCog aria-hidden="true" /><div><strong>绑定服务器资产</strong><p>认领 License，并按稳定 serverInstance 隔离工作区。</p></div></li>
            <li><span>02</span><FileCheck2 aria-hidden="true" /><div><strong>审核每次发布</strong><p>查看差异、诊断、检查与要求，再显式发布。</p></div></li>
            <li><span>03</span><LockKeyhole aria-hidden="true" /><div><strong>会话边界清晰</strong><p>账户使用 HttpOnly Cookie；游戏连接使用单次 Token，两者互不混用。</p></div></li>
          </ol>
          <p className="register-context__note">Orryx 不会要求你把游戏连接 Token 保存到账户、数据库或浏览器存储。</p>
        </aside>
      </div>
    </main>
  )
}
