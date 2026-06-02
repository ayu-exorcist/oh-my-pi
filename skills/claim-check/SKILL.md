---
name: claim-check
description: Audit changed docs for strong claims, benchmarks, numbers, and industry statistics. Verify S0/S1/S2/S3 source mapping without modifying files.
---

# Claim Check

检查当前文档改动中的强结论、数字、benchmark、行业数据是否有来源映射。不要修改文件。

路径说明：本文中未加前缀的路径均相对仓库根目录。

## 先读文件

- AGENTS.md
- README.md
- result/CLAIMS.md
- 与目标文档直接相关的 search-source README 或 source registry（如 search-source/README.md、search-source/source-registry.md）

## 审计步骤

1. 用 git status / git diff 识别改动文件。
2. 区分改动属于哪个区域：
   - result/（最终读者文档）
   - search-source/（数据源/研究轨迹）
   - cli-agents/（CLI Agent 落地映射）
   - .pi/ 或 AGENTS.md（项目配置/提示词）
   - README.md（入口文档）
3. 搜索强结论/数字/benchmark/行业数据类表述：
   - 百分比、绝对数字、ROI、市场规模
   - benchmark 名称及数字（如 pass@1、SWE-bench、Pass^3）
   - “提升”“提效”“规模”“领先”等确定事实表述
   - 2026 预测、厂商口径、排行榜
4. 映射每个强结论到来源层级：
   - S0：论文、标准、官方规格、源码
   - S1：一手工程实践、官方博客、README/release notes
   - S2：高质量社区讨论、issue/PR
   - S3：二手博客、媒体报道、转述
   - S0/S1 可支撑强事实；S2/S3 需交叉验证
5. 判断是否需要同步：
   - result/ 新增/修改强结论 → 同步 result/CLAIMS.md
   - search-source/ 新增/移动 topic → 同步 search-source/README.md、topic README、update-log.md
   - cli-agents/ 修改 landing docs → 同步 cli-agents/README.md 和工具子目录
   - shared templates/UI anti-slop → 同步 result/shared/ 两侧
   - model-outputs/ 修改 → 保持 archive / not final 标记

## 输出章节

```text
## Claims found
## Source mapping status
## Missing or weak evidence
## Required sync files
## Minimal fix plan
```

## 要求

- 区分 S0/S1/S2/S3 来源层级。
- S0/S1/S2/S3 定义以 search-source/source-registry.md 为准。
- 没有来源的强结论不要润色成确定事实。
- 建议最小修复，不做大范围重写。
