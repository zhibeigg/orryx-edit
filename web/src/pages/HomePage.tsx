import {
  ArrowRight,
  BadgeCheck,
  Code2,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import { BrandMark } from "@/components/BrandMark"
import {
  ConnectionStoryboard,
  EditorWorkspaceShowcase,
  SecurityBoundarySummary,
} from "@/components/home/HomeProductShowcase"

const proofItems = [
  { label: "编辑", value: "结构化参数 + YAML", icon: Code2 },
  { label: "校验", value: "Schema + Revision", icon: FileCheck2 },
  { label: "发布", value: "签名事务 + 重载回执", icon: BadgeCheck },
]

function SiteHeader() {
  return (
    <header className="site-header clean-site-header">
      <a className="brand-link clean-brand-link" href="/" aria-label="Orryx 插件门户首页">
        <BrandMark className="brand-mark" />
        <span><strong>ORRYX</strong><small>EDITOR</small></span>
      </a>
      <nav className="site-nav site-nav--desktop" aria-label="主导航">
        <a href="#demo">交互演示</a>
        <a href="#workflow">工作流</a>
        <a href="#security">安全边界</a>
        <a href="https://o0vvjwgpeju.feishu.cn/wiki/Syzzw7aQwixJ4YkXoOAcyYkfnOg" target="_blank" rel="noreferrer">文档</a>
        <a href="/portal">登录</a>
        <a className="site-nav__primary" href="/register">创建账户</a>
      </nav>
      <details className="site-nav-mobile">
        <summary>导航</summary>
        <nav aria-label="移动端主导航">
          <a href="#demo">交互演示</a>
          <a href="#workflow">工作流</a>
          <a href="#security">安全边界</a>
          <a href="/portal">登录 Portal</a>
          <a href="/register">创建账户</a>
        </nav>
      </details>
    </header>
  )
}

export function HomePage() {
  return (
    <div className="portal-home visual-home clean-home">
      <SiteHeader />
      <main id="main-content">
        <section id="demo" className="clean-hero" aria-labelledby="home-title">
          <div className="clean-hero__copy portal-reveal">
            <p className="clean-release"><span aria-hidden="true" />Editor 0.13.20 · 只读交互演示</p>
            <div className="clean-product-lockup">
              <BrandMark className="clean-product-lockup__mark" />
              <strong>Orryx Editor</strong>
            </div>
            <h1 id="home-title">把一套技能，<br />从配置写到服务器。</h1>
            <p className="clean-hero__lead">
              结构化参数、时间轴、YAML、Schema 校验、Revision 与重载结果，在同一个工作区里完成。
            </p>
            <div className="home-actions clean-hero__actions">
              <a className="home-button home-button--primary" href="/register">创建账户<ArrowRight aria-hidden="true" /></a>
              <a className="home-button home-button--secondary" href="https://o0vvjwgpeju.feishu.cn/wiki/Syzzw7aQwixJ4YkXoOAcyYkfnOg" target="_blank" rel="noreferrer">查看文档</a>
            </div>
            <p className="clean-hero__support"><Code2 aria-hidden="true" />Minecraft 1.12–1.21 · <code>/orryx edit</code> 一键连接</p>
          </div>

          <div className="clean-hero__demo portal-reveal">
            <EditorWorkspaceShowcase />
          </div>
        </section>

        <section className="clean-proof" aria-label="Orryx Editor 核心能力">
          {proofItems.map(({ label, value, icon: Icon }) => (
            <div key={label}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        <section id="workflow" className="clean-section clean-section--workflow" aria-labelledby="workflow-title">
          <header className="clean-section__heading">
            <p className="home-kicker"><span aria-hidden="true" />FROM GAME TO SERVER</p>
            <h2 id="workflow-title">不是另一套表单。<br />是一条可验证的生产链。</h2>
            <p>连接从游戏内命令开始；保存只有在快照、校验和服务器回执都明确后才完成。</p>
          </header>
          <ConnectionStoryboard />
        </section>

        <section id="security" className="clean-section clean-section--security" aria-labelledby="security-title">
          <div className="clean-security__copy">
            <p className="home-kicker"><span aria-hidden="true" />SECURITY BOUNDARY</p>
            <h2 id="security-title">界面可以公开，<br />凭据不应该公开。</h2>
            <p>首页演示只在浏览器内切换预置快照。真实 Token、License、serverKey 和生产文件始终留在各自的安全边界内。</p>
            <SecurityBoundarySummary />
          </div>
          <ul className="clean-security__facts" aria-label="Orryx 安全约束">
            <li><LockKeyhole aria-hidden="true" /><span><strong>一次性连接</strong><small>Fragment 在联网前清除，Token 原子消费。</small></span></li>
            <li><Workflow aria-hidden="true" /><span><strong>Revision 冲突检查</strong><small>保存必须基于服务器认可的当前快照。</small></span></li>
            <li><ShieldCheck aria-hidden="true" /><span><strong>签名发布与恢复</strong><small>插件验证目标清单，失败时回滚或进入恢复流程。</small></span></li>
          </ul>
        </section>

        <section className="clean-cta" aria-labelledby="home-cta-title">
          <div>
            <p className="home-kicker"><span aria-hidden="true" />OPEN YOUR WORKSPACE</p>
            <h2 id="home-cta-title">下一次切换，使用你的服务器配置。</h2>
          </div>
          <div className="home-actions">
            <a className="home-button home-button--primary" href="/register">创建 Orryx 账户<ArrowRight aria-hidden="true" /></a>
            <a className="home-button home-button--secondary" href="/portal">进入 Portal</a>
          </div>
        </section>
      </main>

      <footer className="site-footer clean-footer">
        <a className="brand-link brand-link--footer clean-brand-link" href="/">
          <BrandMark className="brand-mark" />
          <span><strong>ORRYX</strong><small>EDITOR</small></span>
        </a>
        <nav aria-label="页尾导航">
          <a href="/portal">Portal</a>
          <a href="/connect">连接页</a>
          <a href="https://o0vvjwgpeju.feishu.cn/wiki/Syzzw7aQwixJ4YkXoOAcyYkfnOg" target="_blank" rel="noreferrer">文档</a>
        </nav>
        <p><Code2 aria-hidden="true" />Editor 0.13.20 · Protocol V1/V2</p>
      </footer>
    </div>
  )
}
