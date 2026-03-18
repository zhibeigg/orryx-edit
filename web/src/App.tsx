import { AppLayout } from "@/components/layout/AppLayout"
import { ConnectPage } from "@/pages/ConnectPage"
import { EditorPage } from "@/pages/EditorPage"
import { AdminPage } from "@/pages/AdminPage"
import { PortalPage } from "@/pages/PortalPage"
import { useConnectionStore } from "@/store/connection-store"
import { useDraftSync } from "@/lib/use-draft-sync"
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts"
import { useCrossRefLoader } from "@/lib/use-cross-ref-loader"
import { TooltipProvider } from "@/components/ui/tooltip"

export default function App() {
  const authenticated = useConnectionStore((s) => s.authenticated)
  useDraftSync()
  useKeyboardShortcuts()
  useCrossRefLoader()

  const path = window.location.pathname
  if (path === "/admin") return <AdminPage />
  if (path === "/portal") return <PortalPage />

  return (
    <TooltipProvider delayDuration={200}>
      <AppLayout>
        {authenticated ? <EditorPage /> : <ConnectPage />}
      </AppLayout>
    </TooltipProvider>
  )
}
