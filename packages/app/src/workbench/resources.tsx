import { A } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { SshConfigPanel } from "@/components/ssh-config-panel"
import { workspaceHomeHref } from "@/workbench/routes"

export function WorkbenchResourcesPage() {
  const language = useLanguage()

  return (
    <div class="os-client-capability-page os-client-resources-page">
      <header class="os-client-resources-head">
        <div class="os-client-resources-head-copy">
          <h2>资源配置</h2>
          <p>SSH 连接配置</p>
        </div>
        <A href={workspaceHomeHref()} class="os-client-resources-close" aria-label="关闭资源配置">
          ×
        </A>
      </header>

      <section class="os-client-capability-selector" aria-label="资源配置">
        <div class="os-client-capability-current-domain">
          <span>当前配置：</span>
          <strong>SSH 连接</strong>
          <small>{language.t("dialog.ssh.description")}</small>
        </div>
      </section>

      <div class="os-client-capability-page-body os-client-resources-body">
        <SshConfigPanel variant="page" />
      </div>
    </div>
  )
}
