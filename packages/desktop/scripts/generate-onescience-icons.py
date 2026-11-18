"""Generate desktop channel icons from packages/desktop/app-icon.png.

Prereq:
  bun ./scripts/render-app-icon.ts
  pip install pillow icnsutil
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image
import icnsutil

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "app-icon.png"
CHANNELS = ("prod", "beta", "dev")


def resize(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.Resampling.LANCZOS)


def save_png(master: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    resize(master, size).save(path, format="PNG")


def write_ico(master: Image.Image, path: Path) -> None:
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    # Prefer BMP frames: PNG-compressed ICO entries often look like a generic
    # Electron icon in Windows Explorer for unsigned / Wine-cross-packed Setup.exe,
    # even though ExtractAssociatedIcon still returns the branded image.
    master.resize((256, 256), Image.Resampling.LANCZOS).save(
        path,
        format="ICO",
        sizes=sizes,
        bitmap_format="bmp",
    )


def write_icns(master: Image.Image, path: Path) -> None:
    tmp = path.parent / "_icns_tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    # Filename suffix drives type guessing in icnsutil.
    entries = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]

    img = icnsutil.IcnsFile()
    try:
        for name, size in entries:
            file_path = tmp / name
            save_png(master, file_path, size)
            img.add_media(file=str(file_path))
        img.write(str(path), toc=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def generate_channel(master: Image.Image, channel: str) -> None:
    dest = ROOT / "icons" / channel
    dest.mkdir(parents=True, exist_ok=True)

    # Electron / Linux core bitmaps
    save_png(master, dest / "icon.png", 512)
    for size in (32, 64, 128):
        save_png(master, dest / f"{size}x{size}.png", size)
    save_png(master, dest / "128x128@2x.png", 256)
    save_png(master, dest / "dock.png", 256)

    # Legacy Windows tile logos kept for pack completeness
    for size in (30, 44, 71, 89, 107, 142, 150, 284, 310):
        save_png(master, dest / f"Square{size}x{size}Logo.png", size)
    save_png(master, dest / "StoreLogo.png", 50)

    write_ico(master, dest / "icon.ico")
    write_icns(master, dest / "icon.icns")

    android = dest / "android"
    for density, size in (
        ("mipmap-mdpi", 48),
        ("mipmap-hdpi", 72),
        ("mipmap-xhdpi", 96),
        ("mipmap-xxhdpi", 144),
        ("mipmap-xxxhdpi", 192),
    ):
        folder = android / density
        folder.mkdir(parents=True, exist_ok=True)
        save_png(master, folder / "ic_launcher.png", size)
        save_png(master, folder / "ic_launcher_round.png", size)
        save_png(master, folder / "ic_launcher_foreground.png", size)

    # Keep existing adaptive-icon XML if present
    anydpi = android / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    values = android / "values"
    values.mkdir(parents=True, exist_ok=True)
    launcher_xml = anydpi / "ic_launcher.xml"
    launcher_xml.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""",
        encoding="utf-8",
    )
    bg_xml = values / "ic_launcher_background.xml"
    bg_xml.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#FFFFFF</color>
</resources>
""",
        encoding="utf-8",
    )

    ios = dest / "ios"
    ios.mkdir(parents=True, exist_ok=True)
    for name, size in (
        ("AppIcon-20x20@1x.png", 20),
        ("AppIcon-20x20@2x.png", 40),
        ("AppIcon-20x20@2x-1.png", 40),
        ("AppIcon-20x20@3x.png", 60),
        ("AppIcon-29x29@1x.png", 29),
        ("AppIcon-29x29@2x.png", 58),
        ("AppIcon-29x29@2x-1.png", 58),
        ("AppIcon-29x29@3x.png", 87),
        ("AppIcon-40x40@1x.png", 40),
        ("AppIcon-40x40@2x.png", 80),
        ("AppIcon-40x40@2x-1.png", 80),
        ("AppIcon-40x40@3x.png", 120),
        ("AppIcon-60x60@2x.png", 120),
        ("AppIcon-60x60@3x.png", 180),
        ("AppIcon-76x76@1x.png", 76),
        ("AppIcon-76x76@2x.png", 152),
        ("AppIcon-83.5x83.5@2x.png", 167),
        ("AppIcon-512@2x.png", 1024),
    ):
        save_png(master, ios / name, size)

    print(f"generated icons/{channel}")


def main() -> None:
    if not MASTER.exists():
        raise SystemExit(f"Missing {MASTER}. Run: bun ./scripts/render-app-icon.ts")
    master = Image.open(MASTER).convert("RGBA")
    for channel in CHANNELS:
        generate_channel(master, channel)
    print("done")


if __name__ == "__main__":
    main()
