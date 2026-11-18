import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
/** User-selected data root; sidecar maps this to ONECODE_EXTRA_PATH when set. */
export const DATA_ROOT_KEY = "dataRoot"
/** First-run setup wizard completed. */
export const SETUP_COMPLETE_KEY = "setupComplete"
/**
 * Last confirmed NSIS install token (or build identity in dev).
 * Mismatch with the current install marker forces the setup wizard again.
 */
export const CONFIRMED_INSTALL_TOKEN_KEY = "confirmedInstallToken"
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
