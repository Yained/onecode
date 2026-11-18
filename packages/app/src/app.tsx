import "@/index.css"
import * as Sentry from "@sentry/solid"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { File } from "@opencode-ai/ui/file"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router, useLocation, useNavigate, useParams } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  lazy,
  on,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider, useGlobalSDK } from "@/context/global-sdk"
import { GlobalSyncProvider, useGlobalSync } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider, useLayout } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider, useNotification } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import { RouteParamsProvider } from "@/hooks/use-route-params"
import { updateCodePanelVisible } from "@/pages/session/code-panel"
import { hasSessionHandoffDraft } from "@/pages/session/handoff"
import { clearStoredCapabilityPrefill } from "@/pages/session/workspace-prompt"
import { clearCodeNewSessionIntent, isCodeNewSessionIntent, markCodeNewSessionIntent } from "@/code-session-navigation"
import { base64Encode } from "@opencode-ai/core/util/encode"
import DirectoryLayout from "@/pages/directory-layout"
import Session from "@/pages/session"
import {
  codeSlugSessionHref,
  codeEntryWorkspaceDirectory,
  codeWorkspaceRecentProjects,
  configuredCodeDefaultDirectory,
  isSharedCodeCatalogDirectory,
  isWorkbenchSharedCaseBrowse,
  oneScienceRoutes,
  workspaceCapabilitiesHref,
  workspaceDevelopmentEntryHref,
  workspaceCaseDomainHref,
  workspaceHomeHref,
  legacyWorkbenchRedirects,
} from "./app-routes"
import { decode64 } from "@/utils/base64"
import { projectDataRoot, relativeProjectFolderPath } from "@/utils/project-folder"
import { ErrorPage } from "./pages/error"
import { useCheckServerHealth } from "./utils/server-health"
import {
  PLATFORM_AUTH_TOKEN_STORAGE_KEY,
  canWritePlatformPath,
  clearPlatformAuthSession,
  defaultPlatformWorkspaceDirectory,
  isDefaultPlatformProject,
  isPlatformAuthRejection,
  isPlatformAuthRequired,
  platformAuthUrl,
  resolvePlatformAuthSession,
  shouldShowPlatformLogin,
  shouldValidatePlatformSession,
  storePlatformAuthSession,
  storedPlatformAuthSession,
} from "./utils/platform-auth"
import { isStaleChunkError, reloadOnceForStaleChunk } from "./utils/stale-chunk"

function lazyRoute<T extends Component<any>>(loader: () => Promise<{ default: T }>) {
  return lazy<T>(() =>
    loader().catch((error: unknown) => {
      if (isStaleChunkError(error)) {
        reloadOnceForStaleChunk()
        const err = error instanceof Error ? error : new Error(String(error))
        // Fallback has no props; cast keeps ParentProps shells (e.g. WorkspaceShell) typed.
        return { default: (() => <ErrorPage error={err} />) as unknown as T }
      }
      throw error
    }),
  )
}

import { WorkbenchHomePage } from "@/workbench/home"
import { WorkbenchShell } from "@/workbench/shell"

/** Lazy sub-routes keep their own Suspense so /workspace home never shares os-route-fallback. */
function suspenseLazyRoute(loader: () => Promise<{ default: Component<any> }>) {
  const Lazy = lazyRoute(loader)
  return (props: any) => (
    <Suspense fallback={<div class="os-route-fallback" aria-busy="true" />}>
      <Lazy {...props} />
    </Suspense>
  )
}

const HomeRoute = lazyRoute(() => import("@/pages/onescience"))
// Eager shell + home: cache-clear F5 used to leave the center on os-route-fallback
// while the sidebar (outside Suspense) still painted.
const WorkbenchHomeRoute = WorkbenchHomePage
const CapabilityCenterRoute = suspenseLazyRoute(() =>
  import("@/workbench/capabilities/center").then((module) => ({ default: module.CapabilityCenterPage })),
)
const CapabilityIntroRoute = suspenseLazyRoute(() =>
  import("@/workbench/capabilities/intro").then((module) => ({ default: module.CapabilityIntroPage })),
)
const CapabilityWizardRoute = suspenseLazyRoute(() =>
  import("@/workbench/capabilities/wizard").then((module) => ({ default: module.CapabilityWizardPage })),
)
const WorkbenchSkillsRoute = suspenseLazyRoute(() =>
  import("@/workbench/skills").then((module) => ({ default: module.WorkbenchSkillsPage })),
)
const WorkbenchDocsRoute = suspenseLazyRoute(() =>
  import("@/workbench/docs").then((module) => ({ default: module.WorkbenchDocsPage })),
)
const WorkbenchResourcesRoute = suspenseLazyRoute(() =>
  import("@/workbench/resources").then((module) => ({ default: module.WorkbenchResourcesPage })),
)
// const UserManagementRoute = lazyRoute(() => import("@/pages/user-management"))
const LoginRoute = lazyRoute(() => import("@/pages/account-system").then((module) => ({ default: module.LoginPage })))
const RegisterRoute = lazyRoute(() => import("@/pages/account-system").then((module) => ({ default: module.RegisterPage })))
const ForgotPasswordRoute = lazyRoute(() => import("@/pages/account-system").then((module) => ({ default: module.ForgotPasswordPage })))
const AccountCenterRoute = lazyRoute(() => import("@/pages/account-system").then((module) => ({ default: module.AccountCenterPage })))

if (typeof window !== "undefined") {
  const preloadShellChunks = () => {
    void import("@/pages/onescience")
    void import("@/pages/account-system")
    void import("@/workbench/shell")
    void import("@/workbench/home")
    void import("@/workbench/capabilities/center")
    void import("@/workbench/capabilities/intro")
    void import("@/workbench/skills")
    void import("@/workbench/docs")
    void import("@/workbench/capabilities/wizard")
  }
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preloadShellChunks, { timeout: 1200 })
  } else {
    setTimeout(preloadShellChunks, 0)
  }
}

const SessionRoute = () => (
  <SessionProviders>
    <Session />
  </SessionProviders>
)

function LegacyWorkbenchRedirect() {
  const location = useLocation()
  const pathOnly = location.pathname.split("?")[0]?.split("#")[0] ?? location.pathname
  if (pathOnly === "/cases") {
    const fragment = location.hash.replace(/^#/, "").trim().toLowerCase()
    if (fragment === "earth" || fragment === "material" || fragment === "life" || fragment === "fluid") {
      return <Navigate href={workspaceCaseDomainHref(fragment)} />
    }
    return <Navigate href={workspaceHomeHref("open")} />
  }
  const target = legacyWorkbenchRedirects[pathOnly] ?? workspaceCapabilitiesHref()
  // Category targets already encode intent in `?category=`; do not append the old page query.
  if (target.includes("?")) return <Navigate href={`${target}${location.hash}`} />
  return <Navigate href={`${target}${location.search}${location.hash}`} />
}

function LegacyCodeSessionRedirect() {
  const params = useParams()
  const location = useLocation()
  if (!params.dir) return <Navigate href={`${oneScienceRoutes.code}${location.search}${location.hash}`} />
  return <Navigate href={`${codeSlugSessionHref(params.dir, params.id)}${location.search}${location.hash}`} />
}

function LegacyCodeWorkspaceRedirect() {
  const params = useParams()
  const location = useLocation()
  if (!params.dir) return <Navigate href={`${oneScienceRoutes.code}${location.search}${location.hash}`} />
  return <Navigate href={`${codeSlugSessionHref(params.dir)}${location.search}${location.hash}`} />
}

function LegacyCodeDirRedirect() {
  const params = useParams()
  const location = useLocation()
  return <Navigate href={`/code/${params.dir}/session${location.search}${location.hash}`} />
}

function LegacyCodeToWorkspaceRedirect() {
  const params = useParams()
  const location = useLocation()
  const sync = useGlobalSync()
  const server = useServer()
  const href = createMemo(() => {
    if (!params.dir) return `${oneScienceRoutes.code}${location.search}${location.hash}`
    if (!sync.bootstrapped || !server.ready()) return
    const pathname = `/code/${params.dir}/session${params.id ? `/${params.id}` : ""}`
    return workspaceDevelopmentEntryHref({
      pathname,
      search: location.search,
      hash: location.hash,
      path: sync.data.path,
      recent: codeWorkspaceRecentProjects(sync.data.project),
      lastCodeWorkspace: server.projects.lastCode(),
    })
  })

  return (
    <Show when={href()} keyed>
      {(target) => <Navigate href={target} />}
    </Show>
  )
}

function CodeWorkspaceEntryRoute() {
  return (
    <AppContextProviders>
      <CodeWorkspaceEntryRedirect />
    </AppContextProviders>
  )
}

function CodeWorkspaceEntryRedirect() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const location = useLocation()
  const navigate = useNavigate()
  let disposed = false
  let redirecting = false
  onCleanup(() => {
    disposed = true
  })
  const recent = createMemo(() =>
    codeWorkspaceRecentProjects(
      sync.data.project
        .reduce((projects, project) => {
          projects.set(project.worktree, {
            expanded: true,
            ...layout.projects.list().find((item) => item.worktree === project.worktree),
            ...project,
          })
          return projects
        }, new Map(layout.projects.list().map((project) => [project.worktree, project])))
        .values(),
    ),
  )

  createEffect(() => {
    if (!sync.bootstrapped || !server.ready()) return

    const session = storedPlatformAuthSession()
    const workspaceRoot = defaultPlatformWorkspaceDirectory(session)?.trim()
    // path getter returns EMPTY { project_data_root: "/data" } while pathQuery is still
    // loading (e.g. after register when accountScope refreshes). Wait for a real path
    // when we have no session workspace to use as mkdir root.
    const pathLoaded = Boolean(sync.data.path.directory?.trim())
    if (!workspaceRoot && !pathLoaded) return

    if (redirecting) return
    redirecting = true

    void (async () => {
      layout.sidebar.open()

      const directory = codeEntryWorkspaceDirectory({
        path: sync.data.path,
        recent: recent(),
        lastCodeWorkspace: server.projects.lastCode(),
      })

      // path.mkdir joins the relative name under the account workspace root.
      // Prefer the session workspace (available immediately after register) so we do
      // not need to wait for path; fall back to loaded project_data_root otherwise.
      const root = workspaceRoot || projectDataRoot(sync.data.path)
      const relative = relativeProjectFolderPath(directory, root)
      if (relative) {
        await globalSDK.client.path.mkdir({ name: relative }).catch(() => undefined)
      }

      layout.projects.open(directory)
      if (!isSharedCodeCatalogDirectory(directory, storedPlatformAuthSession(), configuredCodeDefaultDirectory(document, sync.data.path))) {
        server.projects.touchCode(directory)
      }
      await globalSDK.client.project.current({ directory }).catch(() => undefined)
      if (disposed) return
      const href = workspaceDevelopmentEntryHref({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        path: sync.data.path,
        recent: recent(),
        lastCodeWorkspace: server.projects.lastCode(),
      })
      markCodeNewSessionIntent(base64Encode(directory))
      navigate(href, { replace: true })
    })()
  })

  return null
}

function workspaceRouteParams(pathname: string) {
  const pathOnly = pathname.split("?")[0]?.split("#")[0] ?? pathname
  const match = /^\/workspace\/([^/]+)\/session(?:\/([^/?#]+))?/.exec(pathOnly)
  if (!match) return
  return {
    dir: match[1],
    id: match[2],
  }
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function AppContextProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>{props.children}</HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function AuthRouteGuard(props: ParentProps) {
  const platform = usePlatform()
  const location = useLocation()
  const navigate = useNavigate()
  const platformAuthRequired = isPlatformAuthRequired()
  const [allowedRoute, setAllowedRoute] = createSignal("")
  const [validatedPlatformToken, setValidatedPlatformToken] = createSignal("")
  const route = createMemo(() => `${location.pathname}${location.search}${location.hash}`)

  const goPlatformLogin = (pathname: string, search: string, hash: string) => {
    // Soft navigate — hard location.replace remounts the whole app and makes cancel feel slow.
    navigate(platformAuthUrl({ pathname, search, hash }), { replace: true })
  }

  createEffect(() => {
    const pathname = location.pathname
    const search = location.search
    const hash = location.hash
    const currentRoute = route()
    if (
      typeof localStorage !== "undefined" &&
      shouldShowPlatformLogin({
        pathname,
        hasToken: !!localStorage.getItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY),
        authRequired: platformAuthRequired,
      })
    ) {
      setAllowedRoute("")
      goPlatformLogin(pathname, search, hash)
      return
    }
    if (typeof localStorage !== "undefined" && shouldValidatePlatformSession({ pathname, authRequired: platformAuthRequired })) {
      const platformToken = localStorage.getItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY)
      if (platformToken && validatedPlatformToken() !== platformToken) {
        const cached = storedPlatformAuthSession()
        // Local session still valid: allow immediately and soft-revalidate in the background.
        // Do not block the UI or wipe workspace caches on a routine page reload.
        if (cached && cached.token === platformToken) {
          setValidatedPlatformToken(platformToken)
          setAllowedRoute(currentRoute)
          let cancelled = false
          resolvePlatformAuthSession(platformToken)
            .then(async (session) => {
              if (cancelled) return
              await storePlatformAuthSession(session, platform.storage)
            })
            .catch((error) => {
              if (cancelled) return
              // Only force logout when the server rejects the token — not on network blips.
              if (!isPlatformAuthRejection(error)) return
              void clearPlatformAuthSession(platform.storage).finally(() => {
                goPlatformLogin(pathname, search, hash)
              })
            })
          onCleanup(() => {
            cancelled = true
          })
          return
        }

        let cancelled = false
        setAllowedRoute("")
        resolvePlatformAuthSession(platformToken)
          .then(async (session) => {
            if (cancelled) return
            await storePlatformAuthSession(session, platform.storage)
            if (cancelled) return
            setValidatedPlatformToken(platformToken)
            setAllowedRoute(currentRoute)
          })
          .catch(() => {
            if (cancelled) return
            // No usable cached session — cannot continue without a successful resolve.
            void clearPlatformAuthSession(platform.storage).finally(() => {
              goPlatformLogin(pathname, search, hash)
            })
          })
        onCleanup(() => {
          cancelled = true
        })
        return
      }
    }

    setAllowedRoute(currentRoute)
  })

  // Keep the workspace shell mounted across authenticated navigations.
  // Matching the exact route unmounted the tree for one frame (blank /code pane
  // and the left nav expanding then collapsing).
  return <Show when={allowedRoute() !== ""}>{props.children}</Show>
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return <AuthRouteGuard>{props.children}</AuthRouteGuard>
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void (window as Window & {
            api?: { setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void> }
          }).api?.setTitlebar?.({ mode })
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                if (isStaleChunkError(error) && reloadOnceForStaleChunk()) {
                  return null
                }
                Sentry.captureException(error)
                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <DialogProvider>
                  <MarkedProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </MarkedProvider>
                </DialogProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )

  // Do NOT wrap route children in Suspense: lazy page transitions would replace the
  // entire shell (sidebar included) with a full-screen white fallback.
  const showSplash = () =>
    checkMode() === "blocking" && startupHealthCheck.loading && startupHealthCheck.latest === undefined
  // Use .latest only — reading startupHealthCheck() suspends into nested Suspense and
  // can blank /workspace while the sidebar already painted.
  const healthy = () => startupHealthCheck.latest === true

  return (
    <Show when={!showSplash()} fallback={<div class="h-dvh w-screen bg-background-base" />}>
      <Show
        when={healthy()}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              void healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        <Splash class="w-12 h-15 mb-4" />
        <p class="text-14-regular text-text-base">
          {unreachable()[0]}
          <span class="text-text-strong font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-text-weak">{language.t("app.server.retrying")}</p>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-text-base text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface-base rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    onClick={() => props.onServerSelected?.(key)}
                  >
                    <span class="text-14-regular text-text-strong truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}) {
  const WorkspaceDirectoryShell = (routeProps: ParentProps) => (
    // Workbench already owns left-nav/chrome. Mounting Layout(embeddedCode) here
    // re-ran the full /code sidebar effect graph on every remote cold open and
    // froze the main thread (welcome stuck / Network 0 kB) after cache clear.
    <div class="os-code-embed os-workspace-session-embed">
      <DirectoryLayout prefix="/workspace">{routeProps.children}</DirectoryLayout>
    </div>
  )
  const WorkspaceSessionPanel = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const visible = createMemo(() => {
      const params = workspaceRouteParams(location.pathname)
      if (!params?.dir) return false
      const directory = decode64(params.dir) ?? ""
      const shared = isWorkbenchSharedCaseBrowse(directory, params.id)
      // Cache clear / logout: never keep painting private session messages on a stale URL.
      // Shared cases stay browseable; personal chats fall back to welcome (screenshot 3).
      if (!storedPlatformAuthSession() && !shared) return false
      // A session id is a real chat. Bare /session is the new-session composer for
      // writable personal projects (default project always allowed), or when an explicit
      // new-session intent/handoff was recorded.
      if (params.id) return true
      if (isCodeNewSessionIntent(params.dir) || hasSessionHandoffDraft(params.dir)) return true
      const session = storedPlatformAuthSession()
      if (!session || !directory) return false
      if (isDefaultPlatformProject(session, directory)) return true
      return canWritePlatformPath(session, directory)
    })
    let lastSessionDir: string | undefined
    let lastSessionID: string | undefined

    createEffect(() => {
      const params = workspaceRouteParams(location.pathname)
      if (!params?.dir) return
      lastSessionDir = params.dir
      lastSessionID = params.id
    })

    createEffect(() => {
      const params = workspaceRouteParams(location.pathname)
      if (!params?.dir) return
      const directory = decode64(params.dir) ?? ""
      if (directory && isWorkbenchSharedCaseBrowse(directory, params.id)) return
      const session = storedPlatformAuthSession()
      if (session) {
        if (params.id) return
        if (isCodeNewSessionIntent(params.dir) || hasSessionHandoffDraft(params.dir)) return
        // Writable personal projects can host a bare /workspace/:dir/session URL as a
        // new-session composer. The default project is always allowed so first-login
        // / cache-clear clicks on 「新建会话」 render the chat instead of freezing.
        if (isDefaultPlatformProject(session, directory) || canWritePlatformPath(session, directory)) return
        // Leftover project-click URLs that are not writable should fall back to welcome.
        navigate(workspaceHomeHref(), { replace: true })
        return
      }
      // Logged out (e.g. cleared cache): drop private /session URLs to welcome home.
      navigate(workspaceHomeHref(), { replace: true })
    })

    createEffect(
      on(visible, (v, prev) => {
        updateCodePanelVisible(v)
        if (!prev || v || !lastSessionDir) return
        clearStoredCapabilityPrefill(lastSessionDir, lastSessionID)
        clearCodeNewSessionIntent(lastSessionDir)
      }),
    )

    return (
      <Show when={visible()}>
        <WorkspaceSessionPanelActive />
      </Show>
    )
  }

  const WorkspaceSessionPanelActive = () => {
    const location = useLocation()
    const sync = useGlobalSync()
    const layout = useLayout()
    const server = useServer()
    const notification = useNotification()

    createEffect(() => {
      const route = workspaceRouteParams(location.pathname)
      if (!route?.dir) return
      const directory = decode64(route.dir)
      if (!directory) return
      if (!sync.bootstrapped || !server.ready()) return
      const sessionID = route.id
      // Formerly done by Layout(embeddedCode). Keep activation without mounting
      // the full /code sidebar effect graph (remote cold-open freeze).
      if (sessionID) {
        notification.session.markViewed(sessionID)
        sync.session.setActive(directory, sessionID)
        void sync.session.ensureListed(directory, sessionID)
      } else {
        sync.session.setActive(directory, undefined)
      }
      const timer = window.setTimeout(() => {
        layout.projects.open(directory, { unlessHidden: true })
        void sync.project.loadSessions(directory)
        // Defer touchCode: flipping lastCode remounts welcome providers while Session
        // is still first-painting (remote-first freeze). Welcome now skips providers on
        // session URLs; still delay so sidebar/home do not contend on the same tick.
        const touch = () => {
          if (
            isSharedCodeCatalogDirectory(
              directory,
              storedPlatformAuthSession(),
              configuredCodeDefaultDirectory(document, sync.data.path),
            )
          ) {
            return
          }
          server.projects.touchCode(directory)
        }
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(touch, { timeout: 2_500 })
        } else {
          window.setTimeout(touch, 500)
        }
      }, 0)
      onCleanup(() => clearTimeout(timer))
    })

    const params = createMemo<{ dir?: string; id?: string }>(() => workspaceRouteParams(location.pathname) ?? {})
    // Do not mount Session until project.list has restored SSH env. Cold remote
    // sessions otherwise bootstrap as local and freeze (cache-clear / first click).
    const sessionReady = createMemo(() => !!params().dir && sync.bootstrapped)

    return (
      <section classList={{ "os-code-keepalive": true, "is-active": true }} aria-hidden={false}>
        <Show
          when={sessionReady()}
          fallback={
            <div class="os-route-fallback os-directory-switching" aria-busy="true">
              <div class="os-directory-switching-pulse" />
              <div class="os-directory-switching-pulse is-short" />
              <div class="os-directory-switching-pulse is-mid" />
            </div>
          }
        >
          <RouteParamsProvider params={params}>
            <WorkspaceDirectoryShell>
              <SessionRoute />
            </WorkspaceDirectoryShell>
          </RouteParamsProvider>
        </Show>
      </section>
    )
  }
  const WorkbenchShellRoute = (routeProps: ParentProps) => (
    <AppContextProviders>
      <WorkbenchShell>
        <ScrollView class="wb-main-inner">
          {/* No Suspense here: home is eager; lazy sub-routes wrap themselves in suspenseLazyRoute. */}
          {routeProps.children}
        </ScrollView>
        <WorkspaceSessionPanel />
      </WorkbenchShell>
    </AppContextProviders>
  )

  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      disableHealthCheck={props.disableHealthCheck}
      servers={props.servers}
    >
      <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
        <ServerKey>
          <QueryProvider>
            <GlobalSDKProvider>
              <GlobalSyncProvider>
                <Dynamic
                  component={props.router ?? Router}
                  root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
                >
                  <Route path="/" component={HomeRoute} />
                  <Route path={oneScienceRoutes.login} component={LoginRoute} />
                  <Route path={oneScienceRoutes.register} component={RegisterRoute} />
                  <Route path={oneScienceRoutes.forgotPassword} component={ForgotPasswordRoute} />
                  <Route path={oneScienceRoutes.account} component={AccountCenterRoute} />
                  <Route path="/workspace" component={WorkbenchShellRoute}>
                    <Route path="/" component={WorkbenchHomeRoute} />
                    <Route path="/capabilities" component={CapabilityCenterRoute}>
                      {/* Index leaf required: nested routes without path="/" leave /capabilities unmatched. */}
                      <Route path="/" component={() => null} />
                      {/* /capabilities/:id/wizard before /:id so intro stays available at /:id */}
                      <Route path="/:id/wizard" component={CapabilityWizardRoute} />
                      <Route path="/:id" component={CapabilityIntroRoute} />
                    </Route>
                    <Route path="/skills" component={WorkbenchSkillsRoute} />
                    <Route path="/resources" component={WorkbenchResourcesRoute} />
                    <Route path="/docs" component={WorkbenchDocsRoute} />
                    <Route path="/:dir/session/:id?" component={() => null} />
                  </Route>
                  <Route path="/home" component={LegacyWorkbenchRedirect} />
                  <Route path="/infra" component={LegacyWorkbenchRedirect} />
                  <Route path="/tasks" component={LegacyWorkbenchRedirect} />
                  <Route path="/data-management" component={LegacyWorkbenchRedirect} />
                  <Route path="/datasets" component={LegacyWorkbenchRedirect} />
                  <Route path="/apphub" component={LegacyWorkbenchRedirect} />
                  <Route path="/skills" component={LegacyWorkbenchRedirect} />
                  <Route path="/primitives" component={LegacyWorkbenchRedirect} />
                  <Route path="/research" component={LegacyWorkbenchRedirect} />
                  <Route path="/cases" component={LegacyWorkbenchRedirect} />
                  <Route path="/docs" component={LegacyWorkbenchRedirect} />
                  <Route path="/models" component={LegacyWorkbenchRedirect} />
                  <Route path="/apps" component={LegacyWorkbenchRedirect} />
                  <Route path="/frameworks" component={LegacyWorkbenchRedirect} />
                  <Route path="/operators" component={LegacyWorkbenchRedirect} />
                  <Route path={oneScienceRoutes.code} component={CodeWorkspaceEntryRoute} />
                  <Route path="/code/:dir/session/:id?" component={LegacyCodeToWorkspaceRedirect} />
                  <Route path="/code/:dir" component={LegacyCodeDirRedirect} />
                  <Route path={oneScienceRoutes.devRedirect.from} component={() => <Navigate href={oneScienceRoutes.devRedirect.to} />} />
                  <Route path="/:dir/session/:id?" component={LegacyCodeSessionRedirect} />
                  <Route path="/:dir" component={LegacyCodeWorkspaceRedirect} />
                </Dynamic>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </QueryProvider>
        </ServerKey>
      </ConnectionGate>
    </ServerProvider>
  )
}
