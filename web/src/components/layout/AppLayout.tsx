import { Header } from "./Header"
import { Sidebar } from "./Sidebar"
import { useConnectionStore } from "@/store/connection-store"

export function AppLayout({ children }: { children: React.ReactNode }) {
  const authenticated = useConnectionStore((s) => s.authenticated)

  if (!authenticated) {
    return <>{children}</>
  }

  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
