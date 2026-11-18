import path from "path"
import { Global } from "./global"
import { OneCodeExtraPath } from "./extra-path"
import { ProjectSkillStoragePath } from "./project-skill-storage-path"

export function storageKey(directory: string, dataRoot = OneCodeExtraPath.projectDataRoot()) {
  return ProjectSkillStoragePath.storageKey(directory, dataRoot)
}

export function inlineOpencodeRoot(directory: string) {
  return ProjectSkillStoragePath.inlineOpencodeRoot(directory)
}

export function shadowOpencodeRoot(directory: string, dataRoot = OneCodeExtraPath.projectDataRoot()) {
  const extraConfig = OneCodeExtraPath.configDir()
  const base = extraConfig ?? path.join(Global.Path.config, "project-storage")
  return path.join(base, "projects", storageKey(directory, dataRoot), ".opencode")
}

export function shadowOpencodeRootFromPath(
  directory: string,
  info: { onecode_extra_path?: string; config?: string; project_data_root?: string },
) {
  return ProjectSkillStoragePath.shadowOpencodeRootFromPath(directory, info)
}

export function projectSkillRoots(
  directory: string,
  info?: { onecode_extra_path?: string; config?: string; project_data_root?: string },
) {
  const inline = inlineOpencodeRoot(directory)
  const shadow = info ? shadowOpencodeRootFromPath(directory, info) : shadowOpencodeRoot(directory)
  return shadow === inline ? [inline] : [inline, shadow]
}

export function isProjectSkillLocation(
  location: string,
  directory: string | undefined,
  info?: { onecode_extra_path?: string; config?: string; project_data_root?: string },
) {
  return ProjectSkillStoragePath.isProjectSkillLocation(location, directory, info)
}

export * as ProjectSkillStorage from "./project-skill-storage"
