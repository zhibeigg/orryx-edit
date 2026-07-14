import { useEffect, useReducer, useState, type CSSProperties, type KeyboardEvent } from "react"
import {
  Activity,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  FolderOpen,
  Gamepad2,
  KeyRound,
  LockKeyhole,
  Network,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  TerminalSquare,
  Workflow,
} from "lucide-react"
import {
  createInitialDemoState,
  demoReducer,
  demoSkillOrder,
  demoSkills,
  validationPhaseOrder,
  validationStepState,
  type DemoPhase,
  type DemoView,
} from "./home-demo-state"

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

const viewDefinitions: Array<{ id: DemoView; label: string; icon: typeof Activity }> = [
  { id: "parameters", label: "参数", icon: Activity },
  { id: "timeline", label: "时间轴", icon: Workflow },
  { id: "yaml", label: "YAML", icon: FileCode2 },
  { id: "runtime", label: "运行结果", icon: TerminalSquare },
]

const validationSteps: Array<{
  phase: Exclude<DemoPhase, "idle">
  label: string
  detail: string
}> = [
  { phase: "schema", label: "Schema 检查", detail: "动作、参数和选择器" },
  { phase: "revision", label: "生成 Revision", detail: "基于当前只读快照" },
  { phase: "sync", label: "模拟服务器同步", detail: "不写入任何生产文件" },
  { phase: "ready", label: "模块就绪", detail: "返回重载结果" },
]

function phaseIndex(phase: DemoPhase) {
  return phase === "idle" ? -1 : validationPhaseOrder.indexOf(phase)
}

export function EditorWorkspaceShowcase() {
  const health = useCenterHealth()
  const [state, dispatch] = useReducer(demoReducer, createInitialDemoState())
  const skill = demoSkills[state.skillId]
  const isValidating = state.phase === "schema" || state.phase === "revision" || state.phase === "sync"

  useEffect(() => {
    if (!isValidating) return
    const delay = state.phase === "schema" ? 520 : state.phase === "revision" ? 580 : 720
    const timer = window.setTimeout(() => dispatch({ type: "advance-validation" }), delay)
    return () => window.clearTimeout(timer)
  }, [isValidating, state.phase])

  const healthLabel = health.phase === "up"
    ? `中心在线 · ${health.version}`
    : health.phase === "loading"
      ? "正在检查中心"
      : "中心状态暂不可用"

  const statusMessage = state.phase === "idle"
    ? "选择技能或视图，然后运行一次只读验证。"
    : state.phase === "schema"
      ? "正在检查 Schema 与动作参数…"
      : state.phase === "revision"
        ? "Schema 通过，正在生成演示 Revision…"
        : state.phase === "sync"
          ? `Revision ${state.revision + 1} 已生成，正在模拟服务器同步…`
          : `Revision ${state.revision} 已验证，模块已就绪。`

  const handleViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    let nextIndex = index
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + viewDefinitions.length) % viewDefinitions.length
    if (event.key === "ArrowRight") nextIndex = (index + 1) % viewDefinitions.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = viewDefinitions.length - 1
    const nextView = viewDefinitions[nextIndex]
    dispatch({ type: "select-view", view: nextView.id })
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIndex]
      ?.focus()
  }

  return (
    <figure className="interactive-editor" aria-labelledby="interactive-editor-caption">
      <figcaption id="interactive-editor-caption" className="sr-only">
        可切换技能、参数、时间轴、YAML 和运行结果的 Orryx Editor 只读交互演示。
      </figcaption>

      <header className="interactive-editor__windowbar">
        <div className="interactive-editor__traffic" aria-hidden="true"><span /><span /><span /></div>
        <div className="interactive-editor__window-title">
          <strong>Orryx Editor</strong>
          <span>demo/channel_0</span>
        </div>
        <div className={`interactive-editor__health is-${health.phase}`} aria-live="polite">
          <span aria-hidden="true" />{healthLabel}
        </div>
      </header>

      <div className="interactive-editor__toolbar">
        <div className="interactive-editor__identity">
          <span className="interactive-editor__mark" aria-hidden="true">OX</span>
          <div><strong>{skill.name}</strong><small>{skill.fileName}</small></div>
        </div>

        <div className="interactive-editor__view-tabs" role="tablist" aria-label="编辑器演示视图">
          {viewDefinitions.map(({ id, label, icon: Icon }, index) => (
            <button
              id={`demo-view-tab-${id}`}
              key={id}
              type="button"
              role="tab"
              aria-label={label}
              aria-selected={state.view === id}
              aria-controls={`demo-view-panel-${id}`}
              tabIndex={state.view === id ? 0 : -1}
              className={state.view === id ? "is-active" : ""}
              onClick={() => dispatch({ type: "select-view", view: id })}
              onKeyDown={(event) => handleViewKeyDown(event, index)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="interactive-editor__validate"
          disabled={isValidating}
          aria-busy={isValidating}
          onClick={() => dispatch({ type: "start-validation" })}
        >
          <BadgeCheck aria-hidden="true" />
          {isValidating ? "验证中…" : state.phase === "ready" ? "再次验证" : "验证配置"}
        </button>
      </div>

      <div className="interactive-editor__body">
        <aside className="interactive-editor__skills" aria-label="演示技能文件">
          <div className="interactive-editor__skills-heading">
            <span>SKILL FILES</span>
            <small>{demoSkillOrder.length}</small>
          </div>
          <div className="interactive-editor__skill-list">
            {demoSkillOrder.map((skillId) => {
              const item = demoSkills[skillId]
              const selected = state.skillId === skillId
              return (
                <button
                  type="button"
                  key={item.id}
                  className={selected ? "is-active" : ""}
                  aria-pressed={selected}
                  onClick={() => dispatch({ type: "select-skill", skillId })}
                >
                  <FileCode2 aria-hidden="true" />
                  <span><strong>{item.fileName}</strong><small>{item.type}</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
              )
            })}
          </div>
          <div className="interactive-editor__readonly">
            <LockKeyhole aria-hidden="true" />
            <span><strong>只读交互演示</strong><small>不会写入生产服务器</small></span>
          </div>
        </aside>

        <section className="interactive-editor__workspace" aria-label={`${skill.name} 演示工作区`}>
          <header className="interactive-editor__skill-header">
            <div>
              <span>{skill.type} SKILL</span>
              <h2>{skill.name}</h2>
              <p>{skill.summary}</p>
            </div>
            <dl>
              <div><dt>Revision</dt><dd>{state.revision}</dd></div>
              <div><dt>状态</dt><dd>{state.phase === "ready" ? "READY" : "DEMO"}</dd></div>
            </dl>
          </header>

          <div
            id={`demo-view-panel-${state.view}`}
            className="interactive-editor__panel"
            role="tabpanel"
            aria-labelledby={`demo-view-tab-${state.view}`}
            tabIndex={0}
          >
            {state.view === "parameters" && <ParametersPanel skill={skill} />}
            {state.view === "timeline" && <TimelinePanel skill={skill} />}
            {state.view === "yaml" && <YamlPanel skill={skill} />}
            {state.view === "runtime" && (
              <RuntimePanel
                skill={skill}
                phase={state.phase}
                revision={state.revision}
              />
            )}
          </div>

          <footer className="interactive-editor__statusbar">
            <div className={`interactive-editor__status-copy is-${state.phase}`} aria-live="polite">
              {state.phase === "ready" ? <CheckCircle2 aria-hidden="true" /> : <Activity aria-hidden="true" />}
              <span>{statusMessage}</span>
            </div>
            <button type="button" onClick={() => dispatch({ type: "reset" })}>
              <RotateCcw aria-hidden="true" />重置演示
            </button>
          </footer>
        </section>
      </div>
    </figure>
  )
}

function ParametersPanel({ skill }: { skill: (typeof demoSkills)[keyof typeof demoSkills] }) {
  return (
    <div className="demo-parameters">
      <dl className="demo-parameters__metrics">
        <div><dt>最大等级</dt><dd>{skill.maxLevel}</dd></div>
        <div><dt>冷却时间</dt><dd>{skill.cooldown}</dd></div>
        <div><dt>法力消耗</dt><dd>{skill.mana}</dd></div>
      </dl>
      <dl className="demo-parameters__fields">
        <div><dt>伤害 / 数值公式</dt><dd>{skill.formula}</dd></div>
        <div><dt>目标选择器</dt><dd>{skill.selector}</dd></div>
        <div><dt>配置类型</dt><dd>{skill.type}</dd></div>
        <div><dt>时间轴长度</dt><dd>{skill.totalTicks} ticks</dd></div>
      </dl>
      <p><LockKeyhole aria-hidden="true" />参数来自真实 Orryx 配置结构；首页演示不会开放自由输入。</p>
    </div>
  )
}

function TimelinePanel({ skill }: { skill: (typeof demoSkills)[keyof typeof demoSkills] }) {
  return (
    <div className="demo-timeline-view">
      <header><span>技能时间轴</span><small>{skill.totalTicks} ticks · {(skill.totalTicks / 20).toFixed(1)}s</small></header>
      <div className="demo-timeline-view__ruler" aria-hidden="true">
        <span>0t</span><span>{Math.round(skill.totalTicks * 0.25)}t</span><span>{Math.round(skill.totalTicks * 0.5)}t</span><span>{Math.round(skill.totalTicks * 0.75)}t</span><span>{skill.totalTicks}t</span>
      </div>
      <ol>
        {skill.timeline.map((item) => {
          const start = item.start / skill.totalTicks * 100
          const width = Math.max((item.end - item.start) / skill.totalTicks * 100, 4)
          return (
            <li key={item.id}>
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              <div aria-label={`${item.label}，从 ${item.start} tick 到 ${item.end} tick`}>
                <i className={`is-${item.tone}`} style={{ "--timeline-start": `${start}%`, "--timeline-width": `${width}%` } as CSSProperties} />
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function YamlPanel({ skill }: { skill: (typeof demoSkills)[keyof typeof demoSkills] }) {
  return (
    <div className="demo-yaml-view">
      <header><span>{skill.fileName}</span><small>UTF-8 · comments preserved</small></header>
      <pre aria-label={`${skill.name} YAML 只读预览`}><code>
        {skill.yaml.split("\n").map((line, index) => (
          <span className="demo-yaml-line" key={`${index}-${line}`}><i>{index + 1}</i><span>{line || " "}</span></span>
        ))}
      </code></pre>
      <footer><BadgeCheck aria-hidden="true" />Schema 可验证 · YAML 与结构化视图共享同一快照</footer>
    </div>
  )
}

function RuntimePanel({
  skill,
  phase,
  revision,
}: {
  skill: (typeof demoSkills)[keyof typeof demoSkills]
  phase: DemoPhase
  revision: number
}) {
  const currentPhaseIndex = phaseIndex(phase)
  const runtimeLogs = [
    { phase: "schema" as const, source: "SCHEMA", message: `${skill.fileName} 参数检查通过` },
    { phase: "revision" as const, source: "SNAPSHOT", message: `revision ${phase === "ready" ? revision : revision + 1} generated` },
    { phase: "sync" as const, source: "FILE", message: "模拟文件同步完成 · no production write" },
    { phase: "ready" as const, source: "RELOAD", message: skill.result.reload },
  ]

  return (
    <div className="demo-runtime-view">
      <ol className="demo-runtime-view__steps" aria-label="只读验证进度" tabIndex={0}>
        {validationSteps.map((step) => {
          const state = validationStepState(phase, step.phase)
          return (
            <li className={`is-${state}`} key={step.phase}>
              <span aria-hidden="true">{state === "complete" ? <CheckCircle2 /> : <i />}</span>
              <div><strong>{step.label}</strong><small>{step.detail}</small></div>
            </li>
          )
        })}
      </ol>

      <dl className="demo-runtime-view__results">
        <div><dt>选择结果</dt><dd>{skill.result.selected}</dd></div>
        <div><dt>作用模块</dt><dd>{skill.result.affected}</dd></div>
        <div><dt>目标 Revision</dt><dd>{phase === "ready" ? revision : revision + 1}</dd></div>
      </dl>

      <div className="demo-runtime-view__console">
        <header><TerminalSquare aria-hidden="true" /><span>VALIDATION LOG</span></header>
        <ol>
          {runtimeLogs.map((log) => {
            const logIndex = validationPhaseOrder.indexOf(log.phase)
            const visible = currentPhaseIndex >= logIndex
            return (
              <li className={visible ? "is-visible" : ""} key={log.phase}>
                <time>{visible ? "NOW" : "—"}</time><span>{log.source}</span><p>{visible ? log.message : "等待上一步完成"}</p>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

const storyFrames = [
  {
    step: "01",
    title: "游戏内签发",
    detail: "玩家执行 /orryx edit，生成 5 分钟内有效的一次性链接。",
    icon: Gamepad2,
  },
  {
    step: "02",
    title: "安全进入工作区",
    detail: "浏览器在联网前清除 Fragment，并原子消费 Token。",
    icon: KeyRound,
  },
  {
    step: "03",
    title: "验证后保存",
    detail: "Revision、Schema、签名和重载结果共同决定是否完成发布。",
    icon: Save,
  },
]

export function ConnectionStoryboard() {
  return (
    <ol className="compact-connection-story" aria-label="从游戏到服务器的三步连接流程">
      {storyFrames.map(({ step, title, detail, icon: Icon }) => (
        <li key={step}>
          <span>{step}</span>
          <Icon aria-hidden="true" />
          <div><strong>{title}</strong><p>{detail}</p></div>
        </li>
      ))}
    </ol>
  )
}

export function SecurityBoundarySummary() {
  return (
    <div className="security-boundary-summary">
      <div><Server aria-hidden="true" /><span>运行服</span></div>
      <Network aria-hidden="true" />
      <div><ShieldCheck aria-hidden="true" /><span>Orryx Center</span></div>
      <Network aria-hidden="true" />
      <div><FolderOpen aria-hidden="true" /><span>Editor</span></div>
    </div>
  )
}
