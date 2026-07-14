import type { CSSProperties } from "react"
import {
  ArrowRight,
  BadgeCheck,
  Braces,
  CheckCircle2,
  CloudCog,
  Code2,
  FileCheck2,
  Gamepad2,
  KeyRound,
  LockKeyhole,
  Network,
  PanelTop,
  ShieldCheck,
  TerminalSquare,
  Workflow,
} from "lucide-react"
import { BrandMark } from "@/components/BrandMark"

const capabilities = [
  { number: "01", title: "技能与职业配置", body: "组织 Skills、Jobs、Stations、Selectors 与 70+ Kether 动作，保持大型服务器配置可追踪。", icon: Braces },
  { number: "02", title: "可视化与源码双向编辑", body: "流程图、Monaco 与结构化面板共用同一配置模型，在效率和精确控制之间切换。", icon: PanelTop },
  { number: "03", title: "云草稿与审核", body: "按服务器实例隔离上下文，保留版本、诊断、检查和差异，发布前先让改动可解释。", icon: CloudCog },
  { number: "04", title: "签名发布与恢复", body: "服务端签名目标清单，插件执行 prepare、commit、readiness；失败时自动回滚或进入恢复流程。", icon: FileCheck2 },
]

const workflow = [
  { step: "01", title: "在游戏内执行命令", detail: "玩家执行 /orryx edit，插件向中心注册短时的一次性凭据。", icon: Gamepad2 },
  { step: "02", title: "点击安全连接文本", detail: "聊天只显示“点击打开编辑器 · 5 分钟内有效”，不会把完整 URL 暴露在可见文本中。", icon: KeyRound },
  { step: "03", title: "进入服务器工作区", detail: "浏览器清除地址栏 Fragment 后消费 Token，加载当前服务器文件、协作者和版本。", icon: Network },
]

function SiteHeader() {
  return (
    <header className="site-header">
      <a className="brand-link" href="/" aria-label="Orryx 插件门户首页">
        <BrandMark className="brand-mark" />
        <span><strong>ORRYX</strong><small>PLUGIN CONTROL PLANE</small></span>
      </a>
      <nav className="site-nav site-nav--desktop" aria-label="主导航">
        <a href="#capabilities">插件能力</a>
        <a href="#workflow">工作流程</a>
        <a href="/portal">账户控制台</a>
        <a href="/connect">连接服务器</a>
        <a className="site-nav__primary" href="/register">创建账户</a>
      </nav>
      <details className="site-nav-mobile">
        <summary>导航</summary>
        <nav aria-label="移动端主导航">
          <a href="#capabilities">插件能力</a>
          <a href="#workflow">工作流程</a>
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
    <div className="portal-home">
      <SiteHeader />
      <main id="main-content">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero__copy portal-reveal" style={{ "--reveal-index": 0 } as CSSProperties}>
            <p className="home-kicker"><span aria-hidden="true" />Minecraft 1.12–1.21 · Orryx Editor</p>
            <h1 id="home-title" aria-label="把复杂技能系统，交给一条可审核的生产链。"><span aria-hidden="true">把复杂技能系统，</span><span aria-hidden="true">交给一条可审核</span><span aria-hidden="true">的生产链。</span></h1>
            <p className="home-hero__lead">
              Orryx 面向 Minecraft 服主与插件开发者，将技能、职业、触发器和 Kether 配置从散落文件，
              组织成可编辑、可协作、可验证、可恢复的服务器资产。
            </p>
            <div className="home-actions">
              <a className="home-button home-button--primary" href="/register">创建账户<ArrowRight aria-hidden="true" /></a>
              <a className="home-button home-button--secondary" href="/portal">登录 Portal</a>
            </div>
            <dl className="home-compatibility" aria-label="兼容范围">
              <div><dt>MC</dt><dd>1.12–1.21</dd></div>
              <div><dt>编辑</dt><dd>结构化 + 源码</dd></div>
              <div><dt>发布</dt><dd>签名事务</dd></div>
            </dl>
          </div>

          <div className="home-machine portal-reveal" style={{ "--reveal-index": 1 } as CSSProperties} aria-label="Orryx 安全编辑链路示意图">
            <header>
              <span><TerminalSquare aria-hidden="true" />LIVE LINK</span>
              <strong>/orryx edit</strong>
              <small>TTL 300s</small>
            </header>
            <ol className="machine-rail">
              <li>
                <span className="machine-node">01</span>
                <div><strong>GAME SERVER</strong><small>生成单次凭据</small></div>
                <CheckCircle2 aria-hidden="true" />
              </li>
              <li>
                <span className="machine-node">02</span>
                <div><strong>FRAGMENT GATE</strong><small>内存读取 · 立即清除</small></div>
                <LockKeyhole aria-hidden="true" />
              </li>
              <li>
                <span className="machine-node">03</span>
                <div><strong>EDITOR WORKSPACE</strong><small>文件 · 协作 · 审核</small></div>
                <Workflow aria-hidden="true" />
              </li>
            </ol>
            <div className="machine-output">
              <div><span>AUTH</span><strong>ONE-TIME</strong></div>
              <div><span>STORE</span><strong>MEMORY ONLY</strong></div>
              <div><span>RELEASE</span><strong>SIGNED</strong></div>
            </div>
            <BrandMark className="machine-emblem" />
          </div>
        </section>

        <section id="capabilities" className="home-section capability-section" aria-labelledby="capabilities-title">
          <header className="home-section__heading portal-reveal" style={{ "--reveal-index": 0 } as CSSProperties}>
            <p className="home-kicker"><span aria-hidden="true" />CONFIGURATION RAIL</p>
            <h2 id="capabilities-title">不是另一套表单。是配置进入生产环境前的控制面。</h2>
            <p>从创作到发布，每一步保留上下文、责任边界与恢复路径。</p>
          </header>
          <div className="capability-rail">
            {capabilities.map(({ number, title, body, icon: Icon }, index) => (
              <article className="capability-row portal-reveal" key={number} style={{ "--reveal-index": index + 1 } as CSSProperties}>
                <span className="capability-row__number">{number}</span>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
                <span className="capability-row__status"><BadgeCheck aria-hidden="true" />PRODUCTION</span>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="home-section workflow-section" aria-labelledby="workflow-title">
          <div className="workflow-intro">
            <p className="home-kicker"><span aria-hidden="true" />PLAYER-INITIATED ACCESS</p>
            <h2 id="workflow-title">连接从游戏开始，不从复制凭据开始。</h2>
            <p>命令只允许玩家执行。浏览器只消费 Fragment 中的一次性 Token；没有查询参数，也没有持久化。</p>
            <a className="text-link" href="/connect">查看连接页状态说明<ArrowRight aria-hidden="true" /></a>
          </div>
          <ol className="workflow-list">
            {workflow.map(({ step, title, detail, icon: Icon }) => (
              <li key={step}>
                <span className="workflow-list__step">{step}</span>
                <Icon aria-hidden="true" />
                <div><h3>{title}</h3><p>{detail}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="home-section security-section" aria-labelledby="security-title">
          <div className="security-title-block">
            <ShieldCheck aria-hidden="true" />
            <p className="home-kicker"><span aria-hidden="true" />SECURITY CHAIN</p>
            <h2 id="security-title">凭据只走需要它的那一段路。</h2>
          </div>
          <div className="security-chain" role="list" aria-label="一次性连接安全链路">
            <div role="listitem"><span>01</span><strong>游戏命令</strong><small>仅玩家可生成</small></div>
            <div role="listitem"><span>02</span><strong>5 分钟链接</strong><small>URL Fragment</small></div>
            <div role="listitem"><span>03</span><strong>地址栏清理</strong><small>联网前完成</small></div>
            <div role="listitem"><span>04</span><strong>原子消费</strong><small>成功或失败都失效</small></div>
          </div>
          <p className="security-note"><LockKeyhole aria-hidden="true" />一次性 Token 不进入 Nginx/Ktor 查询日志、浏览器持久存储、数据库或文件。</p>
        </section>

        <section className="home-cta" aria-labelledby="home-cta-title">
          <div>
            <p className="home-kicker"><span aria-hidden="true" />READY FOR YOUR SERVER</p>
            <h2 id="home-cta-title">先建立账户，再把服务器接入可审核的工作流。</h2>
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
        <p><Code2 aria-hidden="true" />Editor 0.9.11 · Protocol V1/V2</p>
      </footer>
    </div>
  )
}
