import { StrictMode, Component, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "#ef4444", fontFamily: "monospace", background: "#0a0e14", minHeight: "100vh" }}>
          <h2>渲染错误</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#71717a", marginTop: 16 }}>{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
