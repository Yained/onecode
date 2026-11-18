import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { A } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"

export type ProductNavItem = {
  title: string
  copy: string
  href: string
  icon?: string
}

export type ProductNavSection = {
  label: string
  eyebrow?: string
  copy?: string
  items: readonly ProductNavItem[]
}

type Variant = "light" | "dark"

const styles: Record<
  Variant,
  {
    trigger: string
    panel: string
    header: string
    headerTitle: string
    close: string
    section: string
    summary: string
    sectionCopy: string
    link: string
    linkTitle: string
    linkCopy: string
  }
> = {
  light: {
    trigger:
      "product-nav-mobile-trigger product-nav-mobile-trigger-light inline-flex items-center justify-center rounded-md border px-2.5 py-2 transition",
    panel: "product-nav-mobile-drawer product-nav-mobile-drawer-light",
    header: "product-nav-mobile-drawer-header product-nav-mobile-drawer-header-light border-b px-4 py-3",
    headerTitle: "text-14-bold",
    close: "product-nav-mobile-drawer-close rounded-md p-1 transition",
    section: "product-nav-mobile-drawer-section border-b py-2 last:border-b-0",
    summary: "product-nav-mobile-drawer-summary list-none cursor-pointer rounded-md px-2 py-2 text-14-bold",
    sectionCopy: "px-2 pb-2 text-12-regular leading-5",
    link: "product-nav-mobile-drawer-link rounded-md px-2 py-2 transition",
    linkTitle: "text-13-medium",
    linkCopy: "mt-1 block text-11-regular leading-4",
  },
  dark: {
    trigger:
      "product-nav-mobile-trigger product-nav-mobile-trigger-dark inline-flex items-center justify-center rounded-md border px-2.5 py-2 transition",
    panel: "product-nav-mobile-drawer product-nav-mobile-drawer-dark",
    header: "product-nav-mobile-drawer-header product-nav-mobile-drawer-header-dark border-b px-4 py-3",
    headerTitle: "text-14-bold",
    close: "product-nav-mobile-drawer-close rounded-md p-1 transition",
    section: "product-nav-mobile-drawer-section border-b py-2 last:border-b-0",
    summary: "product-nav-mobile-drawer-summary list-none cursor-pointer rounded-md px-2 py-2 text-14-bold",
    sectionCopy: "px-2 pb-2 text-12-regular leading-5",
    link: "product-nav-mobile-drawer-link rounded-md px-2 py-2 transition",
    linkTitle: "text-13-medium",
    linkCopy: "mt-1 block text-11-regular leading-4",
  },
}

function ProductNavLink(props: { href: string; class: string; onClick?: () => void; children: JSX.Element }) {
  if (props.href.startsWith("http://") || props.href.startsWith("https://")) {
    return (
      <a href={props.href} class={props.class} target="_blank" rel="noreferrer" onClick={props.onClick}>
        {props.children}
      </a>
    )
  }

  return (
    <A href={props.href} class={props.class} onClick={props.onClick}>
      {props.children}
    </A>
  )
}

export function ProductNavMobileMenu(props: { nav: readonly ProductNavSection[]; variant?: Variant }) {
  const variant = () => props.variant ?? "light"
  const [open, setOpen] = createSignal(false)
  const close = () => setOpen(false)
  const theme = () => styles[variant()]

  createEffect(() => {
    if (!open()) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }

    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    })
  })

  return (
    <>
      <button
        type="button"
        class={`xl:hidden ${theme().trigger}`}
        aria-label="打开导航菜单"
        aria-expanded={open()}
        aria-controls="product-nav-mobile-drawer"
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" size="normal" />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            class="product-nav-mobile-backdrop fixed inset-0 z-[70] xl:hidden"
            aria-hidden="true"
            onClick={close}
          />
          <aside
            id="product-nav-mobile-drawer"
            data-component="product-nav-mobile-drawer"
            data-variant={variant()}
            class={`fixed inset-y-0 right-0 z-[71] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col border-l shadow-2xl xl:hidden ${theme().panel}`}
            role="dialog"
            aria-modal="true"
            aria-label="导航菜单"
          >
            <div class={`flex items-center justify-between ${theme().header}`}>
              <span class={theme().headerTitle}>导航</span>
              <button type="button" class={theme().close} aria-label="关闭导航菜单" onClick={close}>
                <Icon name="close" size="normal" />
              </button>
            </div>
            <nav class="product-nav-mobile-drawer-nav flex-1 overflow-y-auto px-3 py-3">
              <For each={props.nav}>
                {(section) => (
                  <details class={`border-b py-2 last:border-b-0 ${theme().section}`}>
                    <summary class={`list-none cursor-pointer rounded-md px-2 py-2 ${theme().summary}`}>
                      {section.label}
                    </summary>
                    <Show when={section.copy}>
                      <p class={`px-2 pb-2 text-12-regular leading-5 ${theme().sectionCopy}`}>{section.copy}</p>
                    </Show>
                    <div class="grid gap-1 pb-2">
                      <For each={section.items}>
                        {(entry) => (
                          <ProductNavLink href={entry.href} class={theme().link} onClick={close}>
                            <span class={theme().linkTitle}>{entry.title}</span>
                            <span class={`mt-1 block text-11-regular leading-4 ${theme().linkCopy}`}>{entry.copy}</span>
                          </ProductNavLink>
                        )}
                      </For>
                    </div>
                  </details>
                )}
              </For>
            </nav>
          </aside>
        </Portal>
      </Show>
    </>
  )
}
