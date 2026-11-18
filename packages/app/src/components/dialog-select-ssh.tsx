import { SshConfigPanel } from "@/components/ssh-config-panel"

export function DialogSelectSsh(props: { initialMode?: "add"; onClose?: () => void } = {}) {
  return <SshConfigPanel variant="dialog" {...props} />
}
