import { For, Show } from "solid-js"
import { useI18n } from "../context/i18n"
import type { ScienceReport } from "../science-metrics"

function statusLabel(status: ScienceReport["status"], t: ReturnType<typeof useI18n>["t"]) {
  if (status === "passed") return t("ui.science.status.passed")
  if (status === "warning") return t("ui.science.status.warning")
  if (status === "failed") return t("ui.science.status.failed")
  return undefined
}

function domainLabel(domain: string | undefined, t: ReturnType<typeof useI18n>["t"]) {
  if (!domain) return undefined
  const key = `ui.science.domain.${domain}` as const
  const translated = t(key)
  return translated === key ? domain : translated
}

export function ScienceMetricsCard(props: { report: ScienceReport; compact?: boolean }) {
  const i18n = useI18n()
  const status = () => statusLabel(props.report.status, i18n.t)
  const domain = () => domainLabel(props.report.domain, i18n.t)

  return (
    <section data-component="science-metrics-card" data-compact={props.compact ? "" : undefined}>
      <div data-slot="science-metrics-header">
        <div data-slot="science-metrics-title-row">
          <Show when={props.report.title}>
            <h4 data-slot="science-metrics-title">{props.report.title}</h4>
          </Show>
          <Show when={status()}>
            {(label) => (
              <span data-slot="science-metrics-status" data-status={props.report.status}>
                {label()}
              </span>
            )}
          </Show>
        </div>
        <Show when={domain()}>
          {(value) => <div data-slot="science-metrics-domain">{value()}</div>}
        </Show>
        <Show when={props.report.summary}>
          <p data-slot="science-metrics-summary">{props.report.summary}</p>
        </Show>
      </div>

      <div data-slot="science-metrics-table-wrap">
        <table data-slot="science-metrics-table">
          <thead>
            <tr>
              <th>{i18n.t("ui.science.table.metric")}</th>
              <th>{i18n.t("ui.science.table.value")}</th>
              <Show when={props.report.metrics.some((row) => row.baseline)}>
                <th>{i18n.t("ui.science.table.baseline")}</th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.report.metrics}>
              {(row) => (
                <tr>
                  <td>{row.name}</td>
                  <td>
                    {row.value}
                    <Show when={row.unit}>
                      <span data-slot="science-metrics-unit"> {row.unit}</span>
                    </Show>
                    <Show when={row.delta}>
                      <span data-slot="science-metrics-delta"> ({row.delta})</span>
                    </Show>
                  </td>
                  <Show when={props.report.metrics.some((item) => item.baseline)}>
                    <td>{row.baseline ?? "—"}</td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  )
}
