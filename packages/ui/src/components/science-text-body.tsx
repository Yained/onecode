import { For, Show, type JSX } from "solid-js"
import { ScienceMetricsCard } from "./science-metrics-card"
import { reportForMetricsCard, splitScienceText, stripMarkdownImages, type ScienceReport } from "../science-metrics"

export function ScienceTextBody(props: {
  text: string
  streaming?: boolean
  markdown: (text: string) => JSX.Element
}) {
  const segments = () => (props.streaming ? [{ type: "markdown" as const, text: props.text }] : splitScienceText(props.text))
  const hasScience = () => segments().some((segment) => segment.type === "science")

  return (
    <Show
      when={hasScience()}
      fallback={
        <div data-component="science-text-body">
          <MarkdownWithoutImages text={props.text} markdown={props.markdown} />
        </div>
      }
    >
      <div data-component="science-text-body">
        <For each={segments()}>
          {(segment) => (
            <Show
              when={segment.type === "science" ? segment.report : undefined}
              fallback={
                segment.type === "markdown" ? (
                  <MarkdownWithoutImages text={segment.text} markdown={props.markdown} />
                ) : undefined
              }
            >
              {(report) => <ScienceMetricsCard report={reportForMetricsCard(report() as ScienceReport)} />}
            </Show>
          )}
        </For>
      </div>
    </Show>
  )
}

function MarkdownWithoutImages(props: { text: string; markdown: (text: string) => JSX.Element }) {
  const rest = () => stripMarkdownImages(props.text)
  return <Show when={rest()}>{props.markdown(rest())}</Show>
}
