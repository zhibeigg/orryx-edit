import { useId, useState, type FormEvent } from "react"
import { AtSign, KeyRound, LogIn, UserRoundPlus } from "lucide-react"
import { apiErrorMessage } from "@/lib/api-client"
import { accountApi } from "@/lib/account-api"

export type AccountAuthMode = "login" | "register"

interface AccountAuthFormProps {
  mode: AccountAuthMode
  onAuthenticated: () => void
}

export function AccountAuthForm({ mode, onAuthenticated }: AccountAuthFormProps) {
  const prefix = useId().replace(/:/g, "")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const registering = mode === "register"

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (registering) {
        await accountApi.register({ email: email.trim(), password, displayName: displayName.trim() })
      } else {
        await accountApi.login({ email: email.trim(), password })
      }
      onAuthenticated()
    } catch (cause) {
      setError(apiErrorMessage(cause, registering ? "账户创建失败，请检查填写内容后重试。" : "登录失败，请检查邮箱和密码。"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="industrial-form account-auth-form" onSubmit={(event) => void submit(event)} aria-busy={submitting}>
      {registering && (
        <div className="field-group">
          <label htmlFor={`${prefix}-display-name`}>显示名称</label>
          <input
            id={`${prefix}-display-name`}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
            required
            maxLength={80}
          />
        </div>
      )}
      <div className="field-group">
        <label htmlFor={`${prefix}-email`}><AtSign aria-hidden="true" />邮箱</label>
        <input
          id={`${prefix}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div className="field-group">
        <label htmlFor={`${prefix}-password`}><KeyRound aria-hidden="true" />密码</label>
        <input
          id={`${prefix}-password`}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={registering ? "new-password" : "current-password"}
          aria-describedby={registering ? `${prefix}-password-note` : undefined}
          required
          minLength={8}
        />
        {registering && <p id={`${prefix}-password-note`} className="field-note">至少 8 个字符。账户会话仅由服务端 HttpOnly Cookie 管理。</p>}
      </div>
      {error && <p className="status-message status-message--error" role="alert" aria-live="assertive">{error}</p>}
      <button
        className="industrial-button industrial-button--primary account-auth-submit"
        type="submit"
        disabled={submitting || !email.trim() || password.length < 8 || (registering && !displayName.trim())}
      >
        {registering ? <UserRoundPlus aria-hidden="true" /> : <LogIn aria-hidden="true" />}
        {submitting ? (registering ? "正在创建账户…" : "正在登录…") : (registering ? "创建账户" : "登录控制台")}
      </button>
    </form>
  )
}
