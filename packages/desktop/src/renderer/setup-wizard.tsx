import { createSignal, onMount, Show } from "solid-js"

type Props = {
  onComplete: () => void
}

/** Lightweight first-run wizard: confirm data directory (maps to ONECODE_EXTRA_PATH). */
export function SetupWizard(props: Props) {
  const [dataRoot, setDataRoot] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  onMount(() => {
    void window.api.getDataRoot().then((root) => {
      if (root) {
        setDataRoot(root)
        return
      }
      const homeHint = navigator.userAgent.includes("Windows") ? "%USERPROFILE%\\OneCode" : "~/OneCode"
      setDataRoot(homeHint)
    })
  })

  const pickDirectory = async () => {
    const result = await window.api.openDirectoryPicker({
      title: "Choose OneCode data directory",
      multiple: false,
    })
    if (typeof result === "string" && result) setDataRoot(result)
  }

  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      const raw = dataRoot().trim()
      const isPlaceholder = raw.includes("%USERPROFILE%") || raw.startsWith("~/")
      if (raw && !isPlaceholder) {
        await window.api.setDataRoot(raw)
      }
      await window.api.setSetupComplete(true)
      props.onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "9999",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        background: "rgba(15, 23, 42, 0.72)",
        color: "#e2e8f0",
        "font-family": "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "min(32rem, 92vw)",
          background: "#0f172a",
          border: "1px solid #334155",
          "border-radius": "12px",
          padding: "1.5rem",
          display: "grid",
          gap: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 0.35rem", "font-size": "1.25rem" }}>Configure OneCode</h1>
          <p style={{ margin: "0", color: "#94a3b8", "font-size": "0.9rem", "line-height": "1.45" }}>
            Confirm where project data lives (maps to{" "}
            <code style={{ color: "#cbd5e1" }}>ONECODE_EXTRA_PATH</code>). Official skills sync to{" "}
            <code style={{ color: "#cbd5e1" }}>{"{dataRoot}/.agents/oneskills"}</code>. Previous values are
            prefilled when available — you can change them before continuing.
          </p>
        </div>
        <label style={{ display: "grid", gap: "0.4rem", "font-size": "0.85rem" }}>
          Data directory
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              value={dataRoot()}
              onInput={(e) => setDataRoot(e.currentTarget.value)}
              style={{
                flex: "1",
                padding: "0.55rem 0.65rem",
                "border-radius": "8px",
                border: "1px solid #475569",
                background: "#1e293b",
                color: "#f8fafc",
              }}
            />
            <button
              type="button"
              onClick={() => void pickDirectory()}
              style={{
                padding: "0.55rem 0.75rem",
                "border-radius": "8px",
                border: "1px solid #475569",
                background: "#334155",
                color: "#f8fafc",
                cursor: "pointer",
              }}
            >
              Browse
            </button>
          </div>
        </label>
        <Show when={error()}>
          <p style={{ margin: "0", color: "#fca5a5", "font-size": "0.85rem" }}>{error()}</p>
        </Show>
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "0.5rem" }}>
          <button
            type="button"
            disabled={busy()}
            onClick={() => void finish()}
            style={{
              padding: "0.6rem 1rem",
              "border-radius": "8px",
              border: "none",
              background: "#2563eb",
              color: "white",
              cursor: "pointer",
              "font-weight": "600",
            }}
          >
            {busy() ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  )
}
