import { lazy, Suspense } from "react"
import { AppLayout } from "@/components/layout/AppLayout"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCrossRefLoader } from "@/lib/use-cross-ref-loader"
import { useDraftSync } from "@/lib/use-draft-sync"
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts"
import { useCollaboration } from "@/lib/use-collaboration"
import { SaveConflictDialog } from "@/components/editor/SaveConflictDialog"

const EditorPage = lazy(() => import("@/pages/EditorPage").then((module) => ({ default: module.EditorPage })))

export function AuthenticatedEditor() {
  useDraftSync()
  useKeyboardShortcuts()
  useCrossRefLoader()
  useCollaboration()

  return (
    <TooltipProvider delayDuration={200}>
      <AppLayout>
        <Suspense fallback={<div className="editor-loading" aria-live="polite">正在加载编辑器…</div>}>
          <EditorPage />
        </Suspense>
        <SaveConflictDialog />
      </AppLayout>
    </TooltipProvider>
  )
}
