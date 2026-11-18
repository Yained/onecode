import { For, Show, createMemo, createSignal } from "solid-js"

const users = [
  {
    id: "usr_admin",
    name: "平台管理员",
    email: "admin@onescience.ai",
    role: "admin",
    status: "active",
    workspace: "OneScience 默认开发空间",
    envPath: "/data/guest_data/workspaces/admin",
    cpu: 8,
    memory: 32,
    gpu: 1,
    storage: 500,
    usage: 64,
    tokenUsage: 41,
    auth: "token",
  },
  {
    id: "usr_researcher",
    name: "算法研发用户",
    email: "researcher@example.com",
    role: "member",
    status: "active",
    workspace: "PDE 多模型评测空间",
    envPath: "/data/guest_data/workspaces/pde-benchmark",
    cpu: 16,
    memory: 96,
    gpu: 2,
    storage: 1200,
    usage: 78,
    tokenUsage: 57,
    auth: "oidc",
  },
  {
    id: "usr_guest",
    name: "体验用户",
    email: "guest@example.com",
    role: "member",
    status: "limited",
    workspace: "案例复现实验空间",
    envPath: "/data/guest_data/workspaces/cases-demo",
    cpu: 4,
    memory: 16,
    gpu: 0,
    storage: 120,
    usage: 32,
    tokenUsage: 18,
    auth: "github",
  },
] as const

const authProviders = [
  { id: "token", label: "Token 登录", status: "已启用", copy: "保留当前部署方式，适合内网和临时访问。" },
  { id: "oidc", label: "OIDC / SSO", status: "待接入", copy: "面向 Keycloak、Authing、Azure AD 等统一身份系统。" },
  { id: "github", label: "GitHub OAuth", status: "待接入", copy: "适合开源协作和外部研发用户。" },
] as const

const resourcePolicies = [
  { label: "开发环境隔离", value: "workspace_id + env_path", copy: "每个用户进入独立工作区目录，后端查询必须带 workspace_id。" },
  { label: "计算资源配额", value: "CPU / 内存 / GPU", copy: "创建会话、启动任务、模型运行前检查配额。" },
  { label: "用量审计", value: "resource_usage", copy: "记录会话、Token、存储、GPU 时间等消耗。" },
] as const

type User = (typeof users)[number]
type UserID = User["id"]
type UserStatus = User["status"]

function statusLabel(status: UserStatus) {
  if (status === "active") return "正常"
  return "受限"
}

function statusTone(status: UserStatus) {
  if (status === "active") return "green"
  return "slate"
}

function usageTone(value: number) {
  if (value >= 80) return "red"
  if (value >= 60) return "amber"
  return "green"
}

export default function UserManagementPage() {
  const [selectedID, setSelectedID] = createSignal<UserID>(users[0].id)
  const selected = createMemo(() => users.find((user) => user.id === selectedID()) ?? users[0])
  const totalCpu = createMemo(() => users.reduce((sum, user) => sum + user.cpu, 0))
  const totalGpu = createMemo(() => users.reduce((sum, user) => sum + user.gpu, 0))
  const totalStorage = createMemo(() => users.reduce((sum, user) => sum + user.storage, 0))

  return (
    <main class="os-management-page os-user-management-page">
      <header class="os-management-topbar">
        <div class="os-management-title-row">
          <span class="os-user-page-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M8 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path d="M16.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
              <path d="M3.5 19c.6-3.2 2.2-5 4.5-5s3.9 1.8 4.5 5" />
              <path d="M13.5 18.5c.4-2.4 1.5-3.8 3-3.8 1.7 0 2.8 1.4 3.3 3.8" />
            </svg>
          </span>
          <div>
            <h1>用户管理后台</h1>
            <p>管理员管理用户、角色、开发空间、资源配额和第三方登录提供方。</p>
          </div>
        </div>
        <div class="os-management-actions">
          <button type="button" class="os-button os-button-secondary">配置登录方式</button>
          <button type="button" class="os-button os-button-primary">新建用户</button>
        </div>
      </header>

      <section class="os-management-layout os-user-management-layout">
        <aside class="os-management-sidebar">
          <div class="os-user-summary-grid">
            <div>
              <span>用户</span>
              <strong>{users.length}</strong>
            </div>
            <div>
              <span>CPU</span>
              <strong>{totalCpu()}</strong>
            </div>
            <div>
              <span>GPU</span>
              <strong>{totalGpu()}</strong>
            </div>
            <div>
              <span>存储</span>
              <strong>{totalStorage()}GB</strong>
            </div>
          </div>
          <div class="os-management-list">
            <For each={users}>
              {(user) => (
                <button
                  type="button"
                  classList={{ "os-management-list-card": true, "os-user-list-card": true, "is-active": selectedID() === user.id }}
                  onClick={() => setSelectedID(user.id)}
                >
                  <div class="os-management-card-head">
                    <h2>{user.name}</h2>
                    <span data-tone={statusTone(user.status)}>{statusLabel(user.status)}</span>
                  </div>
                  <p>{user.email}</p>
                  <div class="os-user-card-meta">
                    <span>{user.workspace}</span>
                    <span>{user.auth}</span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </aside>

        <section class="os-management-detail">
          <div class="os-management-detail-head">
            <div>
              <h2>{selected().name}</h2>
              <p>{selected().workspace} · {selected().envPath}</p>
            </div>
            <div class="os-user-role-chip">{selected().role === "admin" ? "管理员" : "成员"}</div>
          </div>

          <div class="os-management-metrics">
            <div><span>CPU 核心</span><strong>{selected().cpu}</strong></div>
            <div><span>内存</span><strong>{selected().memory}GB</strong></div>
            <div><span>GPU</span><strong>{selected().gpu}</strong></div>
            <div><span>存储</span><strong>{selected().storage}GB</strong></div>
          </div>

          <div class="os-user-panels">
            <section class="os-management-panel">
              <div class="os-management-section-head">
                <strong>资源使用</strong>
                <span class="os-management-count">实时配额</span>
              </div>
              <ResourceBar label="开发环境资源" value={selected().usage} />
              <ResourceBar label="月度模型 Token" value={selected().tokenUsage} />
              <div class="os-user-quota-table">
                <div><span>会话上限</span><strong>12 个并发</strong></div>
                <div><span>任务队列</span><strong>3 个运行中</strong></div>
                <div><span>默认目录</span><strong>{selected().envPath}</strong></div>
              </div>
            </section>

            <section class="os-management-panel">
              <div class="os-management-section-head">
                <strong>登录提供方</strong>
                <span class="os-management-count">可插拔</span>
              </div>
              <div class="os-auth-provider-list">
                <For each={authProviders}>
                  {(provider) => (
                    <article class="os-auth-provider-card">
                      <div class="os-management-card-head">
                        <h3>{provider.label}</h3>
                        <span data-tone={provider.id === selected().auth ? "green" : "slate"}>{provider.status}</span>
                      </div>
                      <p>{provider.copy}</p>
                    </article>
                  )}
                </For>
              </div>
            </section>
          </div>

          <section class="os-management-panel">
            <div class="os-management-section-head">
              <strong>后端接入边界</strong>
              <span class="os-management-count">下一步开发</span>
            </div>
            <div class="os-user-policy-grid">
              <For each={resourcePolicies}>
                {(policy) => (
                  <article>
                    <span>{policy.label}</span>
                    <strong>{policy.value}</strong>
                    <p>{policy.copy}</p>
                  </article>
                )}
              </For>
            </div>
          </section>
        </section>
      </section>
    </main>
  )
}

function ResourceBar(props: { label: string; value: number }) {
  return (
    <div class="os-user-resource-row" data-tone={usageTone(props.value)}>
      <div class="os-management-progress-row">
        <span>{props.label}</span>
        <strong>{props.value}%</strong>
      </div>
      <div class="os-user-resource-track">
        <div style={{ width: `${props.value}%` }} />
      </div>
      <Show when={props.value >= 80}>
        <p>接近上限，后续应在任务启动前触发配额检查。</p>
      </Show>
    </div>
  )
}
