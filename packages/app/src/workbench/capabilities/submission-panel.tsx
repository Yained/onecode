import { Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { A } from "@solidjs/router"
import { watchSubmissionWorkspace } from "./submission-lifecycle"
import {
  storedPlatformAuthSession,
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
} from "@/utils/platform-auth"

export function CapabilitySubmissionPanel() {
  const [state, setState] = createStore({ accountId: storedPlatformAuthSession()?.account.id })
  onMount(() => {
    watchSubmissionWorkspace(() => storedPlatformAuthSession()?.account.id)
    const refresh = () => setState("accountId", storedPlatformAuthSession()?.account.id)
    const logout = () => setState("accountId", undefined)
    window.addEventListener(platformAuthSessionUpdatedEvent, refresh)
    window.addEventListener(platformAuthLoggingOutEvent, logout)
    window.addEventListener("storage", refresh)
    onCleanup(() => {
      window.removeEventListener(platformAuthSessionUpdatedEvent, refresh)
      window.removeEventListener(platformAuthLoggingOutEvent, logout)
      window.removeEventListener("storage", refresh)
    })
  })
  return (
    <section class="os-submission-panel" aria-label="智能投稿工作台">
      <Show when={state.accountId} keyed fallback={
        <div class="os-submission-intro">
          <h2>智能投稿</h2>
          <p>上传论文，发现候选期刊，检索近期相似论文，通过模型评分比较同刊论文基线。</p>
          <ol><li>论文上传与关键词</li><li>候选期刊发现</li><li>近期论文评分</li><li>投稿判断与依据</li></ol>
          <A class="os-submission-action" href="/login?redirect=%2Fworkspace%2Fcapabilities%3Fcategory%3Dsubmission%26domain%3Dall">登录并开始智能投稿</A>
        </div>
      }>
        {(_accountId) => <iframe title="智能投稿完整流程" src="/intelligent-submission/?embed=1" class="os-submission-frame" />}
      </Show>
    </section>
  )
}
