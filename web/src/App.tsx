import { lazy, Suspense } from "react"
import { parseAppRoute } from "@/lib/app-route"
import { migrateLegacyConnectionLink } from "@/lib/legacy-connection-link"

const HomePage = lazy(() => import("@/pages/HomePage").then((module) => ({ default: module.HomePage })))
const RegisterPage = lazy(() => import("@/pages/RegisterPage").then((module) => ({ default: module.RegisterPage })))
const AdminPage = lazy(() => import("@/pages/AdminPage").then((module) => ({ default: module.AdminPage })))
const PortalPage = lazy(() => import("@/pages/PortalPage").then((module) => ({ default: module.PortalPage })))
const WorkbenchPage = lazy(() => import("@/features/workbench").then((module) => ({ default: module.WorkbenchPage })))
const EditorRoute = lazy(() => import("@/routes/EditorRoute").then((module) => ({ default: module.EditorRoute })))

function RouteFallback({ message = "正在加载界面…" }: { message?: string }) {
  return (
    <main id="main-content" className="route-loading" aria-busy="true" aria-live="polite">
      {message}
    </main>
  )
}

export default function App() {
  if (migrateLegacyConnectionLink()) return <RouteFallback message="正在迁移安全连接链接…" />

  const route = parseAppRoute(window.location.pathname)

  return (
    <Suspense fallback={<RouteFallback />}>
      {route.kind === "home" ? <HomePage />
        : route.kind === "register" ? <RegisterPage />
          : route.kind === "admin" ? <AdminPage />
            : route.kind === "portal" ? <PortalPage />
              : route.kind === "workbench" ? <WorkbenchPage workspaceId={route.workspaceId} serverInstanceId={route.serverInstanceId} />
                : <EditorRoute />}
    </Suspense>
  )
}
