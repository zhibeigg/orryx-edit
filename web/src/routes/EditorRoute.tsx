import { lazy, Suspense, useEffect, useState } from "react"
import { ConnectPage } from "@/pages/ConnectPage"
import { useConnectionStore } from "@/store/connection-store"

const AuthenticatedEditor = lazy(() => import("@/routes/AuthenticatedEditor").then((module) => ({ default: module.AuthenticatedEditor })))
const EDITOR_MIN_WIDTH = 900

function useNarrowEditorViewport() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < EDITOR_MIN_WIDTH)

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${EDITOR_MIN_WIDTH - 1}px)`)
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return narrow
}

function NarrowEditorNotice() {
  return (
    <main id="main-content" className="editor-viewport-notice">
      <section className="industrial-panel editor-viewport-notice__panel" aria-labelledby="editor-width-title">
        <p className="eyebrow">桌面编辑器</p>
        <h1 id="editor-width-title">当前窗口不足以安全加载复杂编辑画布</h1>
        <p>
          Orryx 的流程图、Monaco 与三维预览针对桌面长时间编辑优化。请将窗口扩展到至少 {EDITOR_MIN_WIDTH} px，
          或改用桌面设备后继续；当前页面不会加载这些重型画布。
        </p>
      </section>
    </main>
  )
}

export function EditorRoute() {
  const authenticated = useConnectionStore((state) => state.authenticated)
  const narrow = useNarrowEditorViewport()

  if (!authenticated) return <ConnectPage />
  if (narrow) return <NarrowEditorNotice />

  return (
    <Suspense fallback={<main id="main-content" className="route-loading" aria-live="polite">正在加载编辑器工作区…</main>}>
      <AuthenticatedEditor />
    </Suspense>
  )
}
