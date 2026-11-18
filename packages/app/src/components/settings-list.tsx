import { type Component, type JSX } from "solid-js"

export const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div class="os-client-settings-panel px-4 rounded-lg">{props.children}</div>
}
