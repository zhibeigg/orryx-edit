import { useEffect, useState, type CSSProperties } from "react"
import {
  Activity,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  FolderOpen,
  Gamepad2,
  KeyRound,
  LockKeyhole,
  Monitor,
  Network,
  Save,
  Server,
  ShieldCheck,
  TerminalSquare,
  Workflow,
} from "lucide-react"

type CenterHealthState =
  | { phase: "loading" }
  | { phase: "up"; version: string }
  | { phase: "down" }

function useCenterHealth(): CenterHealthState {
  const [health, setHealth] = useState<CenterHealthState>({ phase: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    fetch("/health/ready", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("center unavailable")
        const payload = await response.json() as { status?: string; version?: string }
        if (payload.status !== "UP") throw new Error("center not ready")
        setHealth({ phase: "up", version: payload.version ?? "current" })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setHealth({ phase: "down" })
      })

    return () => controller.abort()
  }, [])

  return health
}

const timelineRows = [
  { label: "扇形选区", start: "2%", width: "14%", tone: "selector" },
  { label: "播放动作", start: "13%", width: "18%", tone: "motion" },
  { label: "造成伤害", start: "31%", width: "24%", tone: "damage" },
  { label: "熔岩粒子", start: "48%", width: "35%", tone: "effect" },
]

export function EditorWorkspaceShowcase() {
  return (
    <figure className="product-shot product-shot--editor" aria-labelledby="editor-shot-caption">
      <figcaption id="editor-shot-caption" className="sr-only">
        Orryx Editor 技能编辑工作区实景，包含文件树、结构化参数、技能时间轴、YAML 源码和服务器保存状态。
      </figcaption>

      <header className="shot-windowbar">
        <div className="shot-windowbar__title">
          <span className="shot-app-mark" aria-hidden="true">OX</span>
          <div>
            <strong>Orryx Editor</strong>
            <small>伏魔录 · channel_0</small>
          </div>
        </div>
        <div className="shot-windowbar__status"><span aria-hidden="true" />服务器已连接</div>
        <div className="shot-windowbar__collaborators" aria-label="当前协作者">
          <span>知</span><span>无</span><strong>2 人协作</strong>
        </div>
      </header>

      <div className="editor-demo-shell">
        <aside className="editor-demo-files" aria-label="示例文件树">
          <div className="demo-pane-heading">
            <span>文件浏览器</span>
            <small>37 FILES</small>
          </div>
          <ul className="demo-file-tree">
            <li className="is-folder"><ChevronDown aria-hidden="true" /><FolderOpen aria-hidden="true" /><strong>skills</strong></li>
            <li className="is-file is-active"><FileCode2 aria-hidden="true" /><span>烈焰斩.yml</span><small>M</small></li>
            <li className="is-file"><FileCode2 aria-hidden="true" /><span>御剑术.yml</span></li>
            <li className="is-file"><FileCode2 aria-hidden="true" /><span>玄冰护体.yml</span></li>
            <li className="is-folder is-collapsed"><ChevronRight aria-hidden="true" /><FolderOpen aria-hidden="true" /><strong>jobs</strong></li>
            <li className="is-folder is-collapsed"><ChevronRight aria-hidden="true" /><FolderOpen aria-hidden="true" /><strong>stations</strong></li>
            <li className="is-folder is-collapsed"><ChevronRight aria-hidden="true" /><FolderOpen aria-hidden="true" /><strong>selectors</strong></li>
            <li className="is-file is-root"><FileText aria-hidden="true" /><span>config.yml</span></li>
          </ul>
          <div className="demo-file-sync"><CheckCircle2 aria-hidden="true" /><span>文件树已同步</span></div>
        </aside>

        <div className="editor-demo-workspace">
          <div className="demo-tabbar">
            <div className="demo-tab is-active"><FileCode2 aria-hidden="true" /><span>烈焰斩.yml</span><i role="img" aria-label="有未保存修改" /></div>
            <div className="demo-tab"><FileCode2 aria-hidden="true" /><span>selectors.yml</span></div>
            <div className="demo-publish" aria-label="发布面板示例"><Workflow aria-hidden="true" />发布 <b>1</b></div>
          </div>

          <div className="demo-editor-tabs" aria-label="技能编辑视图">
            <span className="is-active">基础选项</span>
            <span>变量</span>
            <span>Actions 脚本</span>
            <span>时间轴</span>
            <span>YAML 源码</span>
          </div>

          <div className="demo-editor-canvas">
            <section className="demo-skill-panel" aria-label="技能结构化参数">
              <header>
                <div>
                  <small>DIRECT SKILL</small>
                  <h3>烈焰斩</h3>
                </div>
                <span><Activity aria-hidden="true" />生产配置</span>
              </header>

              <dl className="demo-skill-metrics">
                <div><dt>等级范围</dt><dd>1 — 5</dd></div>
                <div><dt>冷却时间</dt><dd>8.0 s</dd></div>
                <div><dt>法力消耗</dt><dd>24</dd></div>
              </dl>

              <div className="demo-form-grid">
                <label><span>伤害公式</span><strong>level × 1.8 + 24</strong></label>
                <label><span>目标选择器</span><strong>fan 5 90</strong></label>
              </div>

              <div className="demo-timeline">
                <div className="demo-timeline__head"><span>技能时间轴</span><small>42 ticks · 2.1s</small></div>
                <div className="demo-ruler"><span>0t</span><span>10t</span><span>20t</span><span>30t</span><span>40t</span></div>
                {timelineRows.map((row) => (
                  <div className="demo-timeline-row" key={row.label}>
                    <span>{row.label}</span>
                    <div><i className={`is-${row.tone}`} style={{ left: row.start, width: row.width } as CSSProperties} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="demo-code-panel" aria-label="YAML 源码预览">
              <header><span>YAML SOURCE</span><small>注释保留</small></header>
              <pre aria-label="烈焰斩技能 YAML 示例"><code><span className="code-line"><i>1</i><b>Options:</b></span>{"\n"}<span className="code-line"><i>2</i>  <b>Type:</b> <em>DIRECT</em></span>{"\n"}<span className="code-line"><i>3</i>  <b>MaxLevel:</b> <strong>5</strong></span>{"\n"}<span className="code-line"><i>4</i>  <b>Cooldown:</b> <strong>8</strong></span>{"\n"}<span className="code-line"><i>5</i>  <b>Mana:</b> <strong>24</strong></span>{"\n"}<span className="code-line"><i>6</i><b>Actions:</b> <em>|-</em></span>{"\n"}<span className="code-line"><i>7</i>  <span>select fan 5 90</span></span>{"\n"}<span className="code-line"><i>8</i>  <span>damage &quot;level * 1.8 + 24&quot;</span></span>{"\n"}<span className="code-line"><i>9</i>  <span>particle flame</span></span></code></pre>
              <div className="demo-diagnostics"><BadgeCheck aria-hidden="true" /><span>Schema 通过 · 0 个错误</span></div>
            </section>
          </div>

          <footer className="demo-savebar">
            <span><Save aria-hidden="true" />skills/烈焰斩.yml</span>
            <strong><CheckCircle2 aria-hidden="true" />已保存并同步到服务器</strong>
            <small>revision 42</small>
          </footer>
        </div>
      </div>
    </figure>
  )
}

export function RuntimeOperationsShowcase() {
  const health = useCenterHealth()
  const healthLabel = health.phase === "up" ? "中心在线" : health.phase === "loading" ? "正在检查中心" : "状态暂不可用"

  return (
    <figure className="product-shot product-shot--runtime" aria-labelledby="runtime-shot-caption">
      <figcaption id="runtime-shot-caption" className="sr-only">
        Orryx 中心、Minecraft 运行服与浏览器之间的真实运行链路示例，以及脱敏后的后台事件。
      </figcaption>

      <header className="runtime-windowbar">
        <div><TerminalSquare aria-hidden="true" /><span>SERVER OPERATIONS</span></div>
        <strong className={`runtime-health runtime-health--${health.phase}`} aria-live="polite"><span aria-hidden="true" />{healthLabel}</strong>
        <small>{health.phase === "up" ? `Editor ${health.version}` : "health/ready"}</small>
      </header>

      <div className="runtime-layout">
        <section className="runtime-topology" aria-label="实时连接拓扑">
          <div className="runtime-topology__heading">
            <span>实时连接拓扑</span>
            <small>已验证链路</small>
          </div>
          <div className="runtime-nodes">
            <article>
              <Server aria-hidden="true" />
              <div><strong>GAME SERVER</strong><small>channel_0</small></div>
              <span><i aria-hidden="true" />REGISTERED</span>
            </article>
            <div className="runtime-route" aria-hidden="true"><i /></div>
            <article>
              <Network aria-hidden="true" />
              <div><strong>ORRYX CENTER</strong><small>Relay · Protocol V1</small></div>
              <span><i aria-hidden="true" />READY</span>
            </article>
            <div className="runtime-route" aria-hidden="true"><i /></div>
            <article>
              <Monitor aria-hidden="true" />
              <div><strong>EDITOR SESSION</strong><small>2 collaborators</small></div>
              <span><i aria-hidden="true" />AUTHENTICATED</span>
            </article>
          </div>

          <dl className="runtime-results">
            <div><dt>文件请求</dt><dd><CheckCircle2 aria-hidden="true" />已转发</dd></div>
            <div><dt>版本检查</dt><dd><CheckCircle2 aria-hidden="true" />revision 42</dd></div>
            <div><dt>模块重载</dt><dd><CheckCircle2 aria-hidden="true" />skill ready</dd></div>
            <div><dt>发布事务</dt><dd><ShieldCheck aria-hidden="true" />signed</dd></div>
          </dl>
        </section>

        <section className="runtime-console" aria-label="脱敏服务器后台事件">
          <header><span>RUNNING LOG</span><small>SENSITIVE DATA REDACTED</small></header>
          <ol>
            <li><time>04:26:16</time><span className="log-source">EDITOR</span><p>正在连接固定中心 orryx.mcwar.cn</p></li>
            <li><time>04:26:17</time><span className="log-source">RELAY</span><p>服务器注册成功 · Protocol V1</p></li>
            <li><time>04:31:08</time><span className="log-source">FILE</span><p>skills/烈焰斩.yml revision 42 accepted</p></li>
            <li><time>04:31:08</time><span className="log-source">RELOAD</span><p>skill module ready</p></li>
            <li><time>04:31:09</time><span className="log-source">PUBLISH</span><p>signed manifest committed</p></li>
          </ol>
          <footer><Activity aria-hidden="true" /><span>所有凭据与地址均已脱敏</span><strong>0 ERROR</strong></footer>
        </section>
      </div>
    </figure>
  )
}

const storyFrames = [
  {
    step: "01",
    title: "游戏里发起",
    icon: Gamepad2,
    visual: (
      <div className="story-chat">
        <div><span>OrryxE2E</span><code>/orryx edit</code></div>
        <p>[Orryx] <strong>[点击打开编辑器 · 5 分钟内有效]</strong></p>
      </div>
    ),
  },
  {
    step: "02",
    title: "一次性连接",
    icon: KeyRound,
    visual: (
      <div className="story-gate">
        <div className="story-address"><LockKeyhole aria-hidden="true" /><span>orryx.mcwar.cn/connect</span></div>
        <ol><li className="is-complete"><CheckCircle2 aria-hidden="true" />读取 Fragment</li><li className="is-complete"><CheckCircle2 aria-hidden="true" />原子消费 Token</li><li><Network aria-hidden="true" />进入服务器工作区</li></ol>
      </div>
    ),
  },
  {
    step: "03",
    title: "保存到运行服",
    icon: Save,
    visual: (
      <div className="story-save">
        <div><FileCode2 aria-hidden="true" /><span>skills/烈焰斩.yml</span><small>revision 42</small></div>
        <p><CheckCircle2 aria-hidden="true" /><strong>保存成功</strong><span>服务器文件与编辑器一致</span></p>
      </div>
    ),
  },
]

export function ConnectionStoryboard() {
  return (
    <ol className="connection-story" aria-label="从游戏命令到服务器保存的三个真实界面状态">
      {storyFrames.map(({ step, title, icon: Icon, visual }) => (
        <li key={step}>
          <header><span>{step}</span><Icon aria-hidden="true" /><strong>{title}</strong></header>
          {visual}
        </li>
      ))}
    </ol>
  )
}
