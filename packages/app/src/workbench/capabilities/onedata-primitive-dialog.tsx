import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createSignal, Show } from "solid-js"
import { bindAlreadyPrimitive, catalogErrorMessage, type CatalogAlready } from "./onedata-catalog-api"

export function DialogOnedataAlreadyPrimitive(props: {
  serverUrl: string
  already: CatalogAlready
  onDone: () => void
  onSkip: () => void
}) {
  const [title, setTitle] = createSignal(props.already.title || "")
  const [description, setDescription] = createSignal("")
  const [dataSchema, setDataSchema] = createSignal(props.already.format || "")
  const [usageNotes, setUsageNotes] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  const submit = async () => {
    const name = title().trim()
    if (!name) {
      setError("请填写名称")
      return
    }
    setBusy(true)
    setError("")
    try {
      await bindAlreadyPrimitive(props.serverUrl, props.already.id, {
        title: name,
        ...(description().trim() ? { description: description().trim() } : {}),
        ...(dataSchema().trim() ? { data_schema: dataSchema().trim() } : {}),
        ...(usageNotes().trim() ? { usage_notes: usageNotes().trim() } : {}),
      })
      showToast({
        variant: "success",
        title: "数据说明已保存",
        description: "已绑定到这条可训练数据，可供 Agent / 任务使用。",
      })
      props.onDone()
    } catch (err) {
      setError(catalogErrorMessage(err, "保存数据说明失败"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="补充数据说明" size="normal" fit class="os-onedata-primitive-dialog">
      <div class="os-onedata-primitive-body">
        <p class="os-onedata-primitive-hint">
          可训练数据已就绪。补充几项说明，方便 Agent 正确加载这份数据。可稍后补全。
        </p>
        <label class="os-onedata-field">
          <span>名称</span>
          <input value={title()} onInput={(event) => setTitle(event.currentTarget.value)} required />
        </label>
        <label class="os-onedata-field">
          <span>一句话说明（可选）</span>
          <input
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
            placeholder="例如：论文表格清洗后的训练集"
          />
        </label>
        <label class="os-onedata-field">
          <span>数据长什么样（可选）</span>
          <input
            value={dataSchema()}
            onInput={(event) => setDataSchema(event.currentTarget.value)}
            placeholder="例如：csv 列 title,year,abstract"
          />
        </label>
        <label class="os-onedata-field">
          <span>怎么用 / 注意点（可选）</span>
          <textarea
            rows={3}
            value={usageNotes()}
            onInput={(event) => setUsageNotes(event.currentTarget.value)}
            placeholder="例如：仅英文摘要；训练时按 year 过滤"
          />
        </label>
        <Show when={error()}>
          <p class="os-onedata-error">{error()}</p>
        </Show>
        <div class="os-onedata-primitive-actions">
          <button type="button" disabled={busy()} onClick={() => props.onSkip()}>
            稍后补全
          </button>
          <button type="button" class="os-onedata-action-primary" disabled={busy()} onClick={() => void submit()}>
            {busy() ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
