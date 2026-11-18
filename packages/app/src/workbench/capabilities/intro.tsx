import { For, Show } from "solid-js"
import { A, useLocation, useParams } from "@solidjs/router"
import { getCapabilityResource } from "./catalog"
import { isCapabilityResourceAvailable } from "./model-resources"
import {
  workspaceCapabilitiesHref,
  workspaceCapabilityReturnHref,
  workspaceCapabilityWizardHref,
  catalogSelectionFromSearch,
} from "@/workbench/routes"

function scenariosSectionCopy(category: "onemodel" | "hpc") {
  if (category === "hpc") {
    return {
      title: "不用手写复杂作业脚本",
      body: "选择一个常见软件任务，系统会把输入文件、HPC 资源、运行脚本和审批步骤整理成可执行任务。",
    }
  }
  return {
    title: "不用理解复杂模型细节",
    body: "选择一个常见能力，系统会把研究对象、输入数据、目标和运行偏好整理成可执行任务。",
  }
}

export function CapabilityIntroPage() {
  const params = useParams()
  const location = useLocation()
  const item = () => getCapabilityResource(params.id ?? "")
  const catalog = () => catalogSelectionFromSearch(location.search)
  const returnHref = () =>
    workspaceCapabilityReturnHref(location.search, {
      category: item()?.category ?? "onemodel",
      domain: item()?.domain ?? "materials",
    })

  return (
    <div class="os-client-capability-intro-overlay" role="dialog" aria-modal="true" aria-label="能力介绍">
      <Show
        when={item()}
        fallback={
          <>
            <A class="os-client-capability-intro-backdrop" href={workspaceCapabilitiesHref()} aria-label="关闭介绍" />
            <section class="os-client-capability-intro-dialog">
              <p>未找到该能力。</p>
              <A href={workspaceCapabilitiesHref()}>返回能力中心</A>
            </section>
          </>
        }
      >
        {(resource) => {
          const scenariosCopy = () => scenariosSectionCopy(resource().category)
          const available = () => isCapabilityResourceAvailable(resource())
          return (
          <>
            <A
              class="os-client-capability-intro-backdrop"
              href={returnHref()}
              aria-label="关闭介绍"
            />
            <section class="os-client-capability-intro-dialog">
            <header class="os-client-capability-intro-head">
              <div>
                <span>{resource().intro.title || "30 秒看懂模型"}</span>
                <h2>{resource().name}</h2>
                <p>{resource().intro.subtitle}</p>
                <Show when={!available()}>
                  <p class="os-client-capability-unavailable-hint">暂无 OneScience 源码或魔搭映射，当前不可使用。</p>
                </Show>
              </div>
              <A
                class="os-client-capability-intro-close"
                href={returnHref()}
                aria-label="关闭"
              >
                ×
              </A>
            </header>
            <div class="os-client-capability-intro-matrix">
              <article class="os-client-capability-intro-block" data-tone="suited">
                <h3>适合解决</h3>
                <div class="os-client-capability-intro-chips">
                  <For each={resource().intro.suited}>{(entry) => <span>{entry}</span>}</For>
                </div>
              </article>
              <article class="os-client-capability-intro-block" data-tone="not-for">
                <h3>不建议直接用在</h3>
                <div class="os-client-capability-intro-chips">
                  <For each={resource().intro.notFor}>{(entry) => <span>{entry}</span>}</For>
                </div>
              </article>
              <article class="os-client-capability-intro-block" data-tone="prepare">
                <h3>需要准备什么</h3>
                <ul>
                  <For each={resource().intro.prepare}>{(entry) => <li>{entry}</li>}</For>
                </ul>
              </article>
              <article class="os-client-capability-intro-block" data-tone="flow" aria-label="使用流程">
                <h3>怎么用</h3>
                <ol class="os-client-capability-intro-flow">
                  <For each={resource().intro.steps}>
                    {(step, index) => (
                      <li>
                        <span>{index() + 1}.</span>
                        <strong>{step}</strong>
                      </li>
                    )}
                  </For>
                </ol>
              </article>
            </div>

            <Show when={available()}>
              <section class="os-client-capability-intro-scenarios" aria-label="快捷场景">
                <div class="os-client-capability-intro-scenarios-copy">
                  <h3>{scenariosCopy().title}</h3>
                  <p>{scenariosCopy().body}</p>
                </div>
                <div class="os-client-capability-intro-scenario-grid">
                  <For each={resource().scenarios}>
                    {(scenario) => (
                      <A
                        class="os-client-capability-intro-scenario-card"
                        href={workspaceCapabilityWizardHref(resource().id, scenario.id, catalog())}
                      >
                        <strong>{scenario.title}</strong>
                        <p>{scenario.summary}</p>
                      </A>
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <footer class="os-client-capability-intro-footer">
              <a
                class="os-client-capability-intro-docs-link"
                href={resource().docsHref}
                target="_blank"
                rel="noreferrer"
              >
                深入资料
              </a>
              <Show
                when={available()}
                fallback={
                  <A class="os-client-capability-intro-wizard-link" href={returnHref()}>
                    返回模型库
                  </A>
                }
              >
                <A
                  class="os-client-capability-intro-wizard-link"
                  href={workspaceCapabilityWizardHref(resource().id, undefined, catalog())}
                  data-primary="true"
                >
                  进入能力向导
                </A>
              </Show>
            </footer>
          </section>
          </>
          )
        }}
      </Show>
    </div>
  )
}
