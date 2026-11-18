# OneScience Web Framework Design

## Goal

Rework the web app so `/` is the OneScience product presentation page, while `/home` and resource routes use a white workspace shell with left navigation. `/code` reuses the current opencode development interface.

## Routes

- `/`: product landing page with top dropdown navigation, platform philosophy, quantified resources, highlights, demo video area, achievements, join section, contacts, and recruiting content.
- `/home`: workspace overview based on `home.png`.
- `/code`: current opencode development workflow.
- `/dev`: compatibility redirect to `/code`.
- `/skills`, `/datasets`, `/models`, `/apps`, `/frameworks`, `/operators`, `/infra`, `/apphub`, `/research`, `/cases`, `/docs`: workspace resource pages with card grids.

## Navigation

The product top navigation routes into workspace resource pages and anchors. The workspace left navigation contains:

- 首页
- 代码开发
- Skills
- 数据集
- 模型库
- 应用库
- AI框架
- 通用算子
- 案例
- 文档下载
- 设置

`代码开发` opens `/code`. Resource pages share the same sidebar layout and card presentation similar to `datasets.png` and `models.png`.

## Implementation Notes

Keep changes scoped to the Solid app routing and OneScience page implementation. Reuse existing providers and the current `DevelopmentHome` component for `/code`, so opencode development behavior remains intact.

