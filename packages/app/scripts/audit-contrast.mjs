import { chromium } from "@playwright/test"

const target = process.argv[2] ?? "http://localhost:8004/"
const executablePath = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser"

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})

const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
await page.goto(target, { waitUntil: "networkidle" })
await page.screenshot({ path: "/tmp/onescience-home.png", fullPage: true })

const report = await page.evaluate(() => {
  const rgba = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/)
    if (!match) return null
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()))
    return parts.length >= 3 ? { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 } : null
  }

  const luminance = (color) => {
    const channel = [color.r, color.g, color.b].map((value) => {
      const normalized = value / 255
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2]
  }

  const ratio = (a, b) => {
    const light = Math.max(luminance(a), luminance(b))
    const dark = Math.min(luminance(a), luminance(b))
    return (light + 0.05) / (dark + 0.05)
  }

  const effectiveBackground = (element) => {
    const blend = (top, bottom) => {
      const alpha = top.a + bottom.a * (1 - top.a)
      if (alpha === 0) return { r: 255, g: 255, b: 255, a: 1 }
      return {
        r: Math.round((top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha),
        g: Math.round((top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha),
        b: Math.round((top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha),
        a: alpha,
      }
    }

    const colors = []
    for (let node = element; node && node instanceof Element; node = node.parentElement) {
      const color = rgba(getComputedStyle(node).backgroundColor)
      if (color && color.a > 0) colors.push(color)
      if (color?.a === 1) break
    }
    return colors.reverse().reduce((background, color) => blend(color, background), { r: 255, g: 255, b: 255, a: 1 })
  }

  const selector = [
    ".onescience-page button",
    ".onescience-page a",
    ".onescience-page summary",
    ".onescience-page [role='button']",
    ".onescience-page .rounded-md",
    ".onescience-page .rounded-lg",
  ].join(",")

  return [...document.querySelectorAll(selector)]
    .map((element) => {
      const style = getComputedStyle(element)
      const textColor = rgba(style.color)
      const backgroundColor = effectiveBackground(element)
      const text = element.textContent?.replace(/\s+/g, " ").trim().slice(0, 100) ?? ""
      const rect = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        text,
        className: String(element.getAttribute("class") ?? "").slice(0, 260),
        color: style.color,
        backgroundColor: style.backgroundColor,
        effectiveBackground: `rgb(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b})`,
        contrast: textColor ? Number(ratio(textColor, backgroundColor).toFixed(2)) : null,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      }
    })
    .filter((item) => item.text && item.rect.width > 0 && item.rect.height > 0 && item.contrast !== null)
    .filter((item) => item.contrast < 4.5)
    .sort((a, b) => a.contrast - b.contrast)
    .slice(0, 80)
})

console.log(JSON.stringify({ target, screenshot: "/tmp/onescience-home.png", issues: report }, null, 2))
await browser.close()
