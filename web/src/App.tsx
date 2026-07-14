import { lazy, Suspense } from "react"
import { parseAppRoute } from "@/lib/app-route"

const AdminPage = lazy(() => import("@/pages/AdminPage").then((module) => ({ default: module.AdminPage })))
const PortalPage = lazy(() => import("@/pages/PortalPage").then((module) => ({ default: module.PortalPage })))
const WorkbenchPage = lazy(() => import("@/features/workbench").then((module) => ({ default: module.WorkbenchPage })))
const EditorRoute = lazy(() => import("@/routes/EditorRoute").then((module) => ({ default: module.EditorRoute })))

function RouteFallback() {
  return (
    <main id="main-content" className="route-loading" aria-busy="true" aria-live="polite">
      正在加载界面…
    </main>
  )
}

export default function App() {
  const route = parseAppRoute(window.location.pathname)

  return (
    <Suspense fallback={<RouteFallback />}>
      {route.kind === "admin" ? <AdminPage />
        : route.kind === "portal" ? <PortalPage />
          : route.kind === "workbench" ? <WorkbenchPage workspaceId={route.workspaceId} serverInstanceId={route.serverInstanceId} />
            : <EditorRoute />}
    </Suspense>
  )
}
