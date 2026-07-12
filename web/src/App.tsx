import { lazy, Suspense } from "react"

const AdminPage = lazy(() => import("@/pages/AdminPage").then((module) => ({ default: module.AdminPage })))
const PortalPage = lazy(() => import("@/pages/PortalPage").then((module) => ({ default: module.PortalPage })))
const EditorRoute = lazy(() => import("@/routes/EditorRoute").then((module) => ({ default: module.EditorRoute })))

function RouteFallback() {
  return (
    <main id="main-content" className="route-loading" aria-busy="true" aria-live="polite">
      正在加载界面…
    </main>
  )
}

export default function App() {
  const path = window.location.pathname
  const Route = path === "/admin" ? AdminPage : path === "/portal" ? PortalPage : EditorRoute

  return (
    <Suspense fallback={<RouteFallback />}>
      <Route />
    </Suspense>
  )
}
