import type { CSSProperties } from "react"
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Code2,
  FileCheck2,
  LockKeyhole,
  PanelTop,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import { BrandMark } from "@/components/BrandMark"
import {
  ConnectionStoryboard,
  EditorWorkspaceShowcase,
  RuntimeOperationsShowcase,
} from "@/components/home/HomeProductShowcase"

const proofItems = [
  { label: "编辑方式", value: "结构化面板 + YAML", icon: PanelTop },
  { label: "保存边界", value: "Revision 冲突检查", icon: FileCheck2 },
  { label: "运行反馈", value: "重载结果实时返回", icon: Activity },
  { label: "发布路径", value: "签名事务 + 自动恢复", icon: BadgeCheck },
]

function SiteHeader() {
  return (
    <header className="site-header">
      <a className="brand-link" href="/" aria-label="Orryx 插件门户首页">
        <BrandMark className="brand-mark" />
        <span><strong>ORRYX</strong><small>PLUGIN CONTROL PLANE</small></span>
      </a>
      <nav className="site-nav site-nav--desktop" aria-label="主导航">
        <a href="#editor-preview">编辑器实景</a>
        <a href="#runtime">运行状态</a>
        <a href="#workflow">连接流程</a>
        <a href="/portal">账户控制台</a>
        <a href="/connect">连接服务器</a>
        <a className="site-nav__primary" href="/register">创建账户</a>
      </nav>
      <details className="site-nav-mobile">
        <summary>导航</summary>
        <nav aria-label="移动端主导航">
          <a href="#editor-preview">编辑器实景</a>
          <a href="#runtime">运行状态</a>
          <a href="#workflow">连接流程</a>
          <a href="/portal">账户控制台</a>
          <a href="/connect">连接服务器</a>
          <a href="/register">创建账户</a>
        </nav>
      </details>
    </header>
  )
}

export function HomePage() {
  return (
    <div className="portal-home visual-home">
      <SiteHeader />
      <main id="main-content">
        <section id="editor-preview" className="visual-hero" aria-labelledby="home-title">
          <div className="visual-hero__copy portal-reveal" style={{ "--reveal-index": 0 } as CSSProperties}>
            <p className="home-kicker"><span aria-hidden="true" />REAL EDITOR · REAL SERVER</p>
            <h1 id="home-title">不用想象。<br />先看它如何编辑一套真实技能。</h1>
            <p className="visual-hero__lead">
              文件树、技能参数、Kether、时间轴、YAML 与服务器保存结果，在同一个工作区里完成。
            </p>
            <div className="home-actions">
              <a className="home-button home-button--primary" href="/register">创建账户<ArrowRight aria-hidden="true" /></a>
              <a className="home-button home-button--secondary" href="/portal">进入 Portal</a>
            </div>
            <p className="visual-command"><Code2 aria-hidden="true" /><span>游戏内入口</span><code>/orryx edit</code></p>
          </div>

          <div className="visual-hero__product portal-reveal" style={{ "--reveal-index": 1 } as CSSProperties}>
            <EditorWorkspaceShowcase />
          </div>
        </section>

        <section className="visual-proof-strip" aria-label="编辑器关键结果">
          {proofItems.map(({ label, value, icon: Icon }) => (
            <div key={label}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        <section id="runtime" className="visual-section visual-section--runtime" aria-labelledby="runtime-title">
          <header className="visual-section__heading">
            <p className="home-kicker"><span aria-hidden="true" />SERVER OPERATIONS</p>
            <h2 id="runtime-title">编辑器不是孤岛。<br />后台每一步都看得见。</h2>
            <p>中心健康、运行服注册、文件写入、模块重载和签名发布，直接用运行状态说话。</p>
          </header>
          <RuntimeOperationsShowcase />
        </section>

        <section id="workflow" className="visual-section visual-section--story" aria-labelledby="workflow-title">
          <header className="visual-section__heading visual-section__heading--compact">
            <p className="home-kicker"><span aria-hidden="true" />FROM GAME TO WORKSPACE</p>
            <h2 id="workflow-title">三张画面，看完整条连接链。</h2>
          </header>
          <ConnectionStoryboard />
        </section>

        <section className="visual-guardrail" aria-labelledby="guardrail-title">
          <div className="visual-guardrail__title">
            <ShieldCheck aria-hidden="true" />
            <div>
              <p className="home-kicker"><span aria-hidden="true" />SECURITY BOUNDARY</p>
              <h2 id="guardrail-title">画面可见，凭据不可见。</h2>
            </div>
          </div>
          <ul aria-label="安全约束">
            <li><CheckCircle2 aria-hidden="true" /><span>玩家命令签发</span><strong>一次性 Token</strong></li>
            <li><LockKeyhole aria-hidden="true" /><span>浏览器地址</span><strong>Fragment 立即清除</strong></li>
            <li><Workflow aria-hidden="true" /><span>服务器身份</span><strong>License + serverKey</strong></li>
            <li><BadgeCheck aria-hidden="true" /><span>发布目标</span><strong>签名清单校验</strong></li>
          </ul>
        </section>

        <section className="home-cta visual-cta" aria-labelledby="home-cta-title">
          <div>
            <p className="home-kicker"><span aria-hidden="true" />OPEN THE REAL WORKSPACE</p>
            <h2 id="home-cta-title">下一张编辑器画面，来自你的服务器。</h2>
          </div>
          <a className="home-button home-button--primary" href="/register">创建 Orryx 账户<ArrowRight aria-hidden="true" /></a>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand-link brand-link--footer" href="/">
          <BrandMark className="brand-mark" />
          <span><strong>ORRYX</strong><small>PLUGIN CONTROL PLANE</small></span>
        </a>
        <nav aria-label="页尾导航">
          <a href="/portal">Portal</a>
          <a href="/connect">连接页</a>
          <a href="https://o0vvjwgpeju.feishu.cn/wiki/Syzzw7aQwixJ4YkXoOAcyYkfnOg" target="_blank" rel="noreferrer">文档</a>
        </nav>
        <p><Code2 aria-hidden="true" />Editor 0.9.13 · Protocol V1/V2</p>
      </footer>
    </div>
  )
}
