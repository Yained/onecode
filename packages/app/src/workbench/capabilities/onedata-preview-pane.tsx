import { For, Match, Show, Switch } from "solid-js"
import { formatLabel, type OnedataPreviewModel } from "./onedata-preview"

export function OnedataPreviewPane(props: {
  model: OnedataPreviewModel
  onClose?: () => void
}) {
  return (
    <section class={`os-onedata-preview-pane os-onedata-preview-kind-${props.model.kind}`} aria-label="原始数据预览">
      <header class="os-onedata-preview-head">
        <div class="os-onedata-preview-head-main">
          <span class={`os-onedata-preview-badge os-onedata-preview-badge-${badgeClass(props.model)}`}>
            {formatLabel(props.model.format)}
          </span>
          <div class="os-onedata-preview-titles">
            <strong>{props.model.title}</strong>
            <Show when={props.model.subtitle}>
              <span>{props.model.subtitle}</span>
            </Show>
          </div>
        </div>
        <Show when={props.onClose}>
          <button type="button" class="os-onedata-preview-close" onClick={() => props.onClose?.()}>
            关闭
          </button>
        </Show>
      </header>
      <div class="os-onedata-preview-body">
        <OnedataPreviewBody model={props.model} />
      </div>
    </section>
  )
}

function OnedataPreviewBody(props: { model: OnedataPreviewModel }) {
  return (
    <Switch fallback={<pre class="os-onedata-preview-pre">{props.model.body || "暂无预览内容"}</pre>}>
      <Match when={props.model.kind === "table" && props.model.headers}>
        <div class="os-onedata-preview-table-wrap">
          <table class="os-onedata-preview-table">
            <thead>
              <tr>
                <For each={props.model.headers}>{(cell) => <th>{cell || "—"}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={props.model.rows}>
                {(row) => (
                  <tr>
                    <For each={row}>{(cell) => <td>{cell}</td>}</For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Match>

      <Match when={props.model.kind === "json"}>
        <pre class="os-onedata-preview-pre os-onedata-preview-json">{props.model.body}</pre>
      </Match>

      <Match when={(props.model.kind === "fasta" || props.model.kind === "fastq") && props.model.sequences}>
        <ul class="os-onedata-preview-seq-list">
          <For each={props.model.sequences}>
            {(item) => (
              <li>
                <div class="os-onedata-preview-seq-head">
                  <span>{props.model.kind === "fastq" ? "@" : ">"}</span>
                  <strong>{item.header}</strong>
                  <em>{item.sequence.length} bp</em>
                </div>
                <p class="os-onedata-preview-seq-body">{chunkSequence(item.sequence)}</p>
              </li>
            )}
          </For>
        </ul>
      </Match>

      <Match when={props.model.kind === "pdf" && props.model.lines}>
        <div class="os-onedata-preview-pdf">
          <For each={props.model.lines}>{(line) => <p>{line}</p>}</For>
        </div>
      </Match>

      <Match when={(props.model.kind === "zarr" || props.model.kind === "scientific") && props.model.cards}>
        <ul class="os-onedata-preview-cards">
          <For each={props.model.cards}>
            {(card) => (
              <li>
                <Show when={card.label} fallback={<span class="os-onedata-preview-card-value">{card.value}</span>}>
                  <span class="os-onedata-preview-card-label">{card.label}</span>
                  <span class="os-onedata-preview-card-value">{card.value}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Match>

      <Match when={props.model.kind === "directory"}>
        <div class="os-onedata-preview-directory">
          <ul class="os-onedata-preview-dir-list">
            <For each={props.model.entries}>
              {(entry) => (
                <li data-dir={entry.is_dir ? "true" : "false"}>
                  <span class="os-onedata-preview-dir-mark">{entry.is_dir ? "DIR" : "FILE"}</span>
                  <code>{entry.path}</code>
                  <Show when={entry.size}>
                    <em>{entry.size}</em>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={props.model.truncated}>
            <p class="os-onedata-preview-note">仅显示前若干项</p>
          </Show>
          <Show when={props.model.nested}>
            {(nested) => (
              <div class="os-onedata-preview-nested">
                <div class="os-onedata-preview-nested-label">
                  样例文件{props.model.samplePath ? ` · ${props.model.samplePath}` : ""}
                </div>
                <OnedataPreviewBody model={nested()} />
              </div>
            )}
          </Show>
        </div>
      </Match>

      <Match when={props.model.kind === "structure" && props.model.lines}>
        <div class="os-onedata-preview-structure">
          <For each={props.model.lines}>
            {(line) => <code data-kind={structureKind(line)}>{line || " "}</code>}
          </For>
        </div>
      </Match>

      <Match when={props.model.kind === "empty"}>
        <p class="os-onedata-preview-empty">{props.model.body}</p>
      </Match>

      <Match when={props.model.kind === "text" && props.model.lines}>
        <pre class="os-onedata-preview-pre">{props.model.lines!.join("\n")}</pre>
      </Match>
    </Switch>
  )
}

function badgeClass(model: OnedataPreviewModel) {
  if (model.kind === "table") return "table"
  if (model.kind === "json") return "json"
  if (model.kind === "fasta" || model.kind === "fastq") return "seq"
  if (model.kind === "pdf") return "pdf"
  if (model.kind === "directory") return "dir"
  if (model.kind === "zarr" || model.kind === "scientific") return "sci"
  if (model.kind === "structure") return "struct"
  return "text"
}

function chunkSequence(sequence: string) {
  return sequence.replace(/(.{10})/g, "$1 ").trim()
}

function structureKind(line: string) {
  if (/^(ATOM|HETATM)\b/.test(line)) return "atom"
  if (/^(HEADER|TITLE|COMPND|SOURCE|KEYWDS|EXPDTA|AUTHOR|REMARK|SEQRES|CRYST1|MODEL|ENDMDL|END|DATA_|loop_)\b/i.test(line)) {
    return "meta"
  }
  return "plain"
}
