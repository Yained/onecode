import { For, Show, createSignal } from "solid-js"
import { useServer } from "@/context/server"
import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { oneScienceApiBaseUrl } from "./onescience-catalog"
import type { UserUploadedSkill } from "./onescience-skill-scope"

export type SkillScope = "global" | "project"

export type SkillRepoConfig = {
  id: string
  title: string
  url: string
  scope: SkillScope
  kind?: "index" | "git"
  localPath?: string
  timeCreated: number
}

export type SkillManagerTab = "list" | "repo" | "upload"

/** Keep in sync with packages/opencode skill-management upload limits. */
export const SKILL_NAME_MAX = 32
export const SKILL_DESCRIPTION_MAX = 80

export function validateUploadSkillFields(name: string, description: string): string | undefined {
  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  if (!trimmedName || !trimmedDescription) return "请填写技能标识、描述和 SKILL 正文"
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmedName)) {
    return "技能标识需为小写字母、数字和连字符，且以字母或数字开头"
  }
  if (trimmedName.length > SKILL_NAME_MAX) return `技能标识最多 ${SKILL_NAME_MAX} 个字符`
  if (trimmedDescription.length > SKILL_DESCRIPTION_MAX) {
    return `技能描述最多 ${SKILL_DESCRIPTION_MAX} 个字符`
  }
}

function skillApiUrl(serverUrl: string, directory: string, suffix: string) {
  const query = new URLSearchParams({ directory })
  return `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/skill/${suffix}?${query}`
}

async function readApiError(response: Response, fallback: string) {
  const text = await response.text()
  if (!text) return fallback
  try {
    const json = JSON.parse(text) as { message?: string; data?: { message?: string } }
    if (json.message) return sanitizeApiErrorMessage(json.message, fallback)
    if (json.data?.message) return sanitizeApiErrorMessage(json.data.message, fallback)
  } catch {}
  return sanitizeApiErrorMessage(text, fallback)
}

export function sanitizeApiErrorMessage(raw: string, fallback: string) {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  if (
    /^</.test(trimmed) ||
    /<!DOCTYPE/i.test(trimmed) ||
    /<html[\s>]/i.test(trimmed) ||
    /<head[\s>]/i.test(trimmed) ||
    /<body[\s>]/i.test(trimmed)
  ) {
    return fallback
  }
  const singleLine = trimmed.replace(/\s+/g, " ")
  if (singleLine.length > 240) return `${singleLine.slice(0, 240)}…`
  return singleLine
}

export function formatOneSkillsUpgradeError(raw: string) {
  if (raw.includes("正在更新中")) return raw
  return "更新失败，建议手动更新"
}

export async function listSkillRepos(serverUrl: string, directory: string, sync = false) {
  try {
    const query = new URLSearchParams({ directory })
    if (sync) query.set("sync", "true")
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/skill/repo?${query}`)
    if (!response.ok) return { items: [], loaded: false as const }
    const result = await response.json() as { items: SkillRepoConfig[] }
    return { items: result.items ?? [], loaded: true as const }
  } catch {
    return { items: [], loaded: false as const }
  }
}

export async function createSkillRepo(
  serverUrl: string,
  directory: string,
  input: { title: string; url: string; scope: SkillScope },
) {
  const response = await authenticatedFetch(skillApiUrl(serverUrl, directory, "repo"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new Error(await readApiError(response, "保存仓库配置失败"))
  }
  return await response.json() as SkillRepoConfig
}

export async function removeSkillRepo(serverUrl: string, directory: string, id: string) {
  const response = await authenticatedFetch(skillApiUrl(serverUrl, directory, `repo/${encodeURIComponent(id)}`), {
    method: "DELETE",
  })
  if (!response.ok) {
    throw new Error(await readApiError(response, "删除仓库配置失败"))
  }
}

export async function uploadUserSkill(
  serverUrl: string,
  directory: string,
  input: {
    name: string
    description: string
    scope: SkillScope
    skillBody: string
    assetsArchiveBase64?: string
    assetsArchiveName?: string
    tags?: string[]
  },
) {
  const response = await authenticatedFetch(skillApiUrl(serverUrl, directory, "upload"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new Error(await readApiError(response, "上传技能失败"))
  }
  return await response.json() as { id: string; name: string; path: string; scope: SkillScope; layer: string }
}

export async function deleteUserSkill(serverUrl: string, directory: string, name: string, scope: SkillScope) {
  const query = new URLSearchParams({ directory, scope })
  const response = await authenticatedFetch(
    `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/skill/${encodeURIComponent(name)}?${query}`,
    { method: "DELETE" },
  )
  if (!response.ok) {
    throw new Error(await readApiError(response, "删除技能失败"))
  }
}

export type OneSkillsUpgradeResult = {
  version?: string
  skillCount: number
  skillsDir: string
  releaseUrl: string
  seedSource?: "disk" | "bundled" | "explicit"
  seedVersion?: string
  seedFallbackReason?: string
}

/** Client wait budget for upgrade API; keep above server download timeout (default 90s). */
export const ONESKILLS_UPGRADE_TIMEOUT_MS = 120_000

function upgradeTimeoutSignal(timeoutMs: number) {
  const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (timeout) {
    try {
      return {
        signal: timeout.call(AbortSignal, timeoutMs),
        clear: undefined as (() => void) | undefined,
      }
    } catch {}
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

export async function upgradeOneSkills(serverUrl: string) {
  const timeout = upgradeTimeoutSignal(ONESKILLS_UPGRADE_TIMEOUT_MS)
  let response: Response
  try {
    response = await authenticatedFetch(
      `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/oneskills/upgrade`,
      { method: "POST", signal: timeout.signal },
    )
  } catch (error) {
    const aborted =
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
    throw new Error(
      aborted
        ? `更新 OneSkills 超时（超过 ${Math.round(ONESKILLS_UPGRADE_TIMEOUT_MS / 1000)} 秒）`
        : sanitizeApiErrorMessage(
            error instanceof Error ? error.message : "网络请求失败",
            "更新 OneSkills 失败：无法连接服务",
          ),
    )
  } finally {
    timeout.clear?.()
  }
  if (!response.ok) {
    throw new Error(await readApiError(response, "更新 OneSkills 失败"))
  }
  return await response.json() as OneSkillsUpgradeResult
}

function scopeLabel(scope: SkillScope) {
  return scope === "global" ? "个人全局" : "当前项目"
}

export function gitRepoHostLabel(url: string) {
  try {
    const host = new URL(url.trim()).hostname.replace(/^www\./, "")
    if (host === "github.com") return "GitHub"
    if (host === "gitee.com") return "Gitee"
  } catch {}
  return "Git"
}

const skillScopeOptions = [
  {
    value: "project" as const,
    title: "当前项目",
    copy: "写入项目 skills 目录",
  },
  {
    value: "global" as const,
    title: "个人全局",
    copy: "写入全局 skills 目录",
  },
]

export function SkillScopeField(props: { value: SkillScope; onChange: (value: SkillScope) => void }) {
  return (
    <div class="os-skill-scope-field">
      <span class="os-field-label os-skill-scope-field-label">
        作用范围
        <span class="os-field-required" aria-hidden="true"> *</span>
      </span>
      <div class="os-skill-scope-toggle" role="radiogroup" aria-label="作用范围">
        <For each={skillScopeOptions}>
          {(option) => (
            <button
              type="button"
              class="os-skill-scope-option"
              role="radio"
              aria-checked={props.value === option.value}
              data-active={props.value === option.value ? "true" : undefined}
              data-tone={option.value}
              onClick={() => props.onChange(option.value)}
            >
              <span class="os-skill-scope-option-copy">
                <strong>{option.title}</strong>
                <small>{option.copy}</small>
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("无法读取压缩包"))
        return
      }
      resolve(result.split(",")[1] ?? "")
    }
    reader.onerror = () => reject(new Error("无法读取压缩包"))
    reader.readAsDataURL(file)
  })
}

export function SkillRepoManager(props: {
  directory: string
  repos: readonly SkillRepoConfig[]
  loaded: boolean
  loading?: boolean
  onChanged?: () => void | Promise<void>
}) {
  const server = useServer()
  const [title, setTitle] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [scope, setScope] = createSignal<SkillScope>("project")
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const submit = async (event: Event) => {
    event.preventDefault()
    const current = server.current
    if (!current) {
      setError("当前没有可用服务")
      return
    }
    if (!title().trim() || !url().trim()) {
      setError("请填写仓库名称和地址")
      return
    }
    setSaving(true)
    setError("")
    try {
      await createSkillRepo(current.http.url, props.directory, {
        title: title().trim(),
        url: url().trim(),
        scope: scope(),
      })
      setTitle("")
      setUrl("")
      setScope("project")
      await props.onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const current = server.current
    if (!current) return
    await removeSkillRepo(current.http.url, props.directory, id)
    await props.onChanged?.()
  }

  return (
    <div class="os-skill-manager-panel">
      <section class="os-skill-manager-section">
        <div class="os-skill-manager-section-head">
          <h3>添加开源仓库</h3>
          <p>
            支持 GitHub / Gitee 技能目录（如{" "}
            <a href="https://github.com/obra/superpowers/tree/main/skills" target="_blank" rel="noreferrer">Superpowers</a>
            、
            <a href="https://gitee.com/onescience-ai/oneskills/tree/master/skills" target="_blank" rel="noreferrer">OneSkills</a>
            ）或 <code>index.json</code> 索引；Git 地址会通过 <code>git clone</code> 拉取，需本机已安装 git 且可访问目标仓库。
          </p>
        </div>
        <form class="os-skill-manager-form" onSubmit={submit}>
          <div class="os-skill-manager-form-grid">
            <label>
              <span class="os-field-label">
                仓库名称
                <span class="os-field-required" aria-hidden="true"> *</span>
              </span>
              <input required aria-required="true" value={title()} placeholder="例如 OneSkills 社区仓库" onInput={(event) => setTitle(event.currentTarget.value)} />
            </label>
            <SkillScopeField value={scope()} onChange={setScope} />
            <label class="os-skill-manager-form-wide">
              <span class="os-field-label">
                仓库地址
                <span class="os-field-required" aria-hidden="true"> *</span>
              </span>
              <input required aria-required="true" value={url()} placeholder="https://github.com/.../tree/main/skills 或 https://gitee.com/.../tree/master/skills" onInput={(event) => setUrl(event.currentTarget.value)} />
            </label>
          </div>
          <Show when={error()}>{(message) => <div class="os-skill-manager-alert">{message()}</div>}</Show>
          <div class="os-skill-manager-form-actions">
            <button class="os-button os-button-primary os-skill-manager-submit" type="submit" disabled={saving()}>{saving() ? "保存中..." : "添加仓库"}</button>
          </div>
        </form>
      </section>

      <section class="os-skill-manager-section">
        <div class="os-skill-manager-section-head">
          <h3>已配置仓库</h3>
          <p>这些仓库会写入对应作用域的 <code>opencode.json</code>（Git 仓库写入 <code>skills.paths</code>，索引地址写入 <code>skills.urls</code>）。</p>
        </div>
        <Show
          when={props.repos.length > 0}
          fallback={<div class="os-skill-manager-empty">{props.loaded ? "尚未配置开源技能仓库。" : "正在加载仓库配置..."}</div>}
        >
          <div class="os-skill-repo-list">
            <For each={props.repos}>
              {(repo) => (
                <article class="os-skill-repo-card">
                  <div class="os-skill-repo-card-head">
                    <div>
                      <strong>{repo.title}</strong>
                      <span class="os-skill-manager-scope" data-tone={repo.scope === "global" ? "global" : "project"}>{scopeLabel(repo.scope)}</span>
                      <Show when={repo.kind === "git"}>
                        <span class="os-skill-manager-scope" data-tone="project">{gitRepoHostLabel(repo.url)}</span>
                      </Show>
                    </div>
                    <button class="os-button os-button-secondary" type="button" onClick={() => void remove(repo.id)}>移除</button>
                  </div>
                  <code>{repo.url}</code>
                </article>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  )
}

export function SkillUploadForm(props: {
  directory: string
  uploaded?: readonly UserUploadedSkill[]
  loaded?: boolean
  loading?: boolean
  deleting?: string
  onCreated?: () => void
  onDelete?: (item: UserUploadedSkill) => void
}) {
  const server = useServer()
  const [name, setName] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [scope, setScope] = createSignal<SkillScope>("project")
  const [skillBody, setSkillBody] = createSignal("")
  const [tags, setTags] = createSignal("")
  const [assetsFile, setAssetsFile] = createSignal<File>()
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  let assetsInput!: HTMLInputElement

  const clearAssetsFile = () => {
    setAssetsFile(undefined)
    if (assetsInput) assetsInput.value = ""
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    const current = server.current
    if (!current) {
      setError("当前没有可用服务")
      return
    }
    if (!skillBody().trim()) {
      setError("请填写技能标识、描述和 SKILL 正文")
      return
    }
    const fieldError = validateUploadSkillFields(name(), description())
    if (fieldError) {
      setError(fieldError)
      return
    }
    setSaving(true)
    setError("")
    try {
      const file = assetsFile()
      await uploadUserSkill(current.http.url, props.directory, {
        name: name().trim(),
        description: description().trim(),
        scope: scope(),
        skillBody: skillBody().trim(),
        ...(tags().trim() ? { tags: tags().split(/[，,\s]+/).map((tag) => tag.trim()).filter(Boolean) } : {}),
        ...(file ? { assetsArchiveBase64: await readFileAsBase64(file), assetsArchiveName: file.name } : {}),
      })
      setName("")
      setDescription("")
      setScope("project")
      setSkillBody("")
      setTags("")
      setAssetsFile(undefined)
      props.onCreated?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败")
    } finally {
      setSaving(false)
    }
  }

  const shortPath = (location: string) => {
    const value = location.replace(/\\/g, "/")
    const parts = value.split("/")
    if (parts.length <= 4) return value
    return `…/${parts.slice(-3).join("/")}`
  }

  return (
    <div class="os-skill-manager-panel">
      <section class="os-skill-manager-section">
        <div class="os-skill-manager-section-head">
          <h3>上传自定义技能</h3>
          <p>写入项目或个人全局 skills 目录，上传成功后会出现在下方列表，可随时删除。</p>
        </div>
        <form class="os-skill-manager-form" onSubmit={submit}>
          <div class="os-skill-manager-form-grid">
            <label>
              <span class="os-skill-manager-field-meta">
                <span class="os-field-label">
                  技能标识
                  <span class="os-field-required" aria-hidden="true"> *</span>
                </span>
                <span class="os-skill-manager-char-count">
                  {name().length}/{SKILL_NAME_MAX}
                </span>
              </span>
              <input
                required
                aria-required="true"
                maxLength={SKILL_NAME_MAX}
                value={name()}
                placeholder="my-data-skill"
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <SkillScopeField value={scope()} onChange={setScope} />
            <label class="os-skill-manager-form-wide">
              <span class="os-skill-manager-field-meta">
                <span class="os-field-label">
                  技能描述
                  <span class="os-field-required" aria-hidden="true"> *</span>
                </span>
                <span class="os-skill-manager-char-count">
                  {description().length}/{SKILL_DESCRIPTION_MAX}
                </span>
              </span>
              <textarea
                required
                aria-required="true"
                maxLength={SKILL_DESCRIPTION_MAX}
                value={description()}
                placeholder="描述该技能解决的问题、输入输出和触发条件"
                onInput={(event) => setDescription(event.currentTarget.value)}
              />
            </label>
            <label class="os-skill-manager-form-wide">
              <span>标签（可选）</span>
              <input value={tags()} placeholder="data, pipeline, custom" onInput={(event) => setTags(event.currentTarget.value)} />
            </label>
          </div>

          <label class="os-skill-manager-form-wide">
            <span class="os-field-label">
              SKILL 正文
              <span class="os-field-required" aria-hidden="true"> *</span>
            </span>
            <textarea required aria-required="true" value={skillBody()} placeholder="编写技能步骤、约束、示例和触发条件等详细说明" onInput={(event) => setSkillBody(event.currentTarget.value)} />
          </label>
          <div class="os-skill-manager-assets-upload">
            <Show
              when={assetsFile()}
              fallback={
                <label class="os-skill-manager-dropzone">
                  <input
                    ref={assetsInput}
                    type="file"
                    accept=".zip,.tar,.tar.gz,.tgz,application/zip,application/x-tar,application/gzip"
                    onInput={(event) => setAssetsFile(event.currentTarget.files?.[0])}
                  />
                  <strong>点击选择压缩包（可选）</strong>
                  <span>支持 zip / tar / tar.gz，包内直接放 references/、assets/ 目录</span>
                </label>
              }
            >
              {(file) => (
                <div class="os-skill-manager-assets-selected">
                  <div class="os-skill-manager-assets-selected-copy">
                    <div>
                      <strong>{file().name}</strong>
                      <span>已选择压缩包，上传后将解压到技能目录</span>
                    </div>
                  </div>
                  <div class="os-skill-manager-assets-selected-actions">
                    <label class="os-button os-button-secondary">
                      更换
                      <input
                        ref={assetsInput}
                        type="file"
                        accept=".zip,.tar,.tar.gz,.tgz,application/zip,application/x-tar,application/gzip"
                        onInput={(event) => setAssetsFile(event.currentTarget.files?.[0])}
                      />
                    </label>
                    <button class="os-button os-button-secondary" type="button" onClick={clearAssetsFile}>
                      移除
                    </button>
                  </div>
                </div>
              )}
            </Show>
          </div>

          <Show when={error()}>{(message) => <div class="os-skill-manager-alert">{message()}</div>}</Show>
          <div class="os-skill-manager-form-actions">
            <button class="os-button os-button-primary os-skill-manager-submit" type="submit" disabled={saving()}>{saving() ? "上传中..." : "上传技能"}</button>
          </div>
        </form>
      </section>

      <section class="os-skill-manager-section">
        <div class="os-skill-manager-section-head">
          <h3>已上传技能</h3>
          <p>仅展示通过本页上传的项目 / 个人全局技能，内置 OneSkills 与仓库同步技能请在「技能列表」或「配置仓库」中管理。</p>
        </div>
        <Show
          when={(props.uploaded?.length ?? 0) > 0}
          fallback={
            <div class="os-skill-manager-empty">
              {props.loaded ? "尚未上传自定义技能。" : "正在加载已上传技能..."}
            </div>
          }
        >
          <div class="os-skill-repo-list">
            <For each={props.uploaded ?? []}>
              {(item) => (
                <article class="os-skill-repo-card">
                  <div class="os-skill-repo-card-head">
                    <div>
                      <strong>{item.name}</strong>
                      <span class="os-skill-manager-scope" data-tone={item.scope === "global" ? "global" : "project"}>
                        {scopeLabel(item.scope)}
                      </span>
                    </div>
                    <button
                      class="os-button os-button-secondary"
                      type="button"
                      disabled={props.deleting === item.name}
                      aria-label={`删除技能 ${item.name}`}
                      onClick={() => props.onDelete?.(item)}
                    >
                      {props.deleting === item.name ? "删除中…" : "删除"}
                    </button>
                  </div>
                  <p class="os-skill-uploaded-copy">{item.description || "暂无描述"}</p>
                  <code title={item.location}>{shortPath(item.location)}</code>
                </article>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  )
}
