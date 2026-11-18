import { Show, createSignal } from "solid-js"
import type { CapabilityDomain } from "./catalog"
import { domainUploadLabel } from "./scenario-catalog"
import { savePrivateModel, type PrivateModelAsset } from "./private-assets"

export type PrivateCapabilityAsset = Pick<PrivateModelAsset, "id" | "name">

function parseTags(value: string) {
  return value
    .split(/[,，、]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function CapabilityResourceUploadDialog(props: {
  open: boolean
  page: "models" | "datasets"
  domain: CapabilityDomain
  onClose: () => void
  onSaved: (asset: PrivateCapabilityAsset) => void
}) {
  const [name, setName] = createSignal("")
  const [blurb, setBlurb] = createSignal("")
  const [tags, setTags] = createSignal("")
  const [error, setError] = createSignal("")

  const reset = () => {
    setName("")
    setBlurb("")
    setTags("")
    setError("")
  }

  const close = () => {
    reset()
    props.onClose()
  }

  const submit = (event: Event) => {
    event.preventDefault()
    const nextName = name().trim()
    const nextBlurb = blurb().trim()
    const nextTags = parseTags(tags())
    if (!nextName || !nextBlurb || nextTags.length === 0) {
      setError("请填写名称、简介和至少一个标签，以便生成与现有模型卡片一致的展示信息。")
      return
    }
    const asset = savePrivateModel({
      name: nextName,
      blurb: nextBlurb,
      tags: nextTags,
      domain: props.domain,
    })
    props.onSaved({ id: asset.id, name: asset.name })
    close()
  }

  return (
    <Show when={props.open}>
      <div class="os-client-capability-wizard-overlay" role="dialog" aria-modal="true" aria-label="上传私有模型">
        <button type="button" class="os-client-capability-wizard-backdrop" aria-label="关闭上传" onClick={close} />
        <form class="os-client-capability-upload-dialog" onSubmit={submit}>
          <header class="os-client-capability-upload-head">
            <div class="os-client-capability-upload-head-copy">
              <div class="os-client-capability-upload-eyebrow">私有资产 · 模型</div>
              <h2>上传私有模型</h2>
              <p>填写与模型卡片一致的基础信息。保存后会出现在当前领域的 onemodel 列表，并标注为私有资产。</p>
            </div>
            <button type="button" class="os-client-capability-upload-close" aria-label="关闭" onClick={close}>
              ×
            </button>
          </header>

          <div class="os-client-capability-upload-notice" role="note">
            <strong>后台登记为 AI 原语</strong>
            <p>
              AI 原语是后台知识资产体系，不对用户单独展示。上传后会自动登记，供 Agent
              检索与编排时利用该模型知识。
            </p>
          </div>

          <div class="os-client-capability-upload-body">
            <label class="os-client-capability-upload-field">
              <span>
                名称<span class="os-client-capability-upload-required"> *</span>
              </span>
              <small>显示在模型卡片标题</small>
              <input
                maxlength={64}
                required
                placeholder="例如：团队内部微调 MACE"
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>

            <label class="os-client-capability-upload-field">
              <span>
                简介<span class="os-client-capability-upload-required"> *</span>
              </span>
              <small>对应卡片正文，建议 1–2 句说明用途与适用场景</small>
              <textarea
                maxlength={160}
                required
                rows={3}
                placeholder="例如：面向界面体系的内部势函数，可用于弛豫与短时程 MD 冒烟"
                value={blurb()}
                onInput={(event) => setBlurb(event.currentTarget.value)}
              />
            </label>

            <div class="os-client-capability-upload-grid" data-cols="2">
              <label class="os-client-capability-upload-field">
                <span>
                  标签<span class="os-client-capability-upload-required"> *</span>
                </span>
                <small>逗号分隔，将显示为卡片标签；系统会自动加上「私有」</small>
                <input
                  required
                  placeholder="例如：mlff, 界面, 内部模型"
                  value={tags()}
                  onInput={(event) => setTags(event.currentTarget.value)}
                />
              </label>
              <label class="os-client-capability-upload-field">
                <span>领域</span>
                <small>跟随当前能力中心领域，卡片会出现在该领域下</small>
                <input class="is-readonly" readOnly value={domainUploadLabel(props.domain)} />
              </label>
            </div>
          </div>

          <Show when={error()}>
            <p class="os-client-capability-upload-error" role="alert">
              {error()}
            </p>
          </Show>

          <footer class="os-client-capability-upload-actions">
            <button type="button" onClick={close}>
              取消
            </button>
            <button type="submit" data-primary="true">
              保存并发布
            </button>
          </footer>
        </form>
      </div>
    </Show>
  )
}
