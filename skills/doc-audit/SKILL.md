---
name: doc-audit
description: Read-only audit of repo doc structure and sync relationships. Verify CLAIMS, search-source, cli-agents, and model-outputs consistency without modifying files.
---

# Doc Audit

只读审计本仓库文档结构和同步关系，不要修改文件。

路径说明：本文中未加前缀的路径均相对仓库根目录。

## 先读文件

- AGENTS.md
- README.md

根据目标再读相关目录 README：

- result/README.md
- search-source/README.md
- cli-agents/README.md
- result/model-outputs/README.md（检查是否被误当 final doc 引用）

## 审计步骤

1. 用 git status / git diff 识别当前改动文件和区域。
2. 按区域检查同步需求：
   - result/ 强结论或关键数字 → 是否需要同步 result/CLAIMS.md
   - search-source/ 新增或移动 topic → 是否需要同步 search-source/README.md、topic README、update-log.md
   - cli-agents/ 修改 → 是否需要同步 cli-agents/README.md 和具体工具子目录入口
   - result/team 或 result/personal 模板改动 → 是否需要同步另一侧模板或 result/shared/templates/README.md
   - UI/UX anti-slop 规则改动 → 是否需要同步 result/shared/ui-ux-anti-ai-slop.md
3. 检查 model-outputs 引用：
   - grep 搜索 result/model-outputs/ 或 model-outputs 在 result/team/、result/personal/、cli-agents/ 中的引用
   - 确认引用把 model outputs 当作 archive / intermediate / not final，而非最终结论
4. 检查链接有效性：
   - 所有相对路径的 Markdown 链接或路径引用是否指向存在的文件
5. 检查 JSON 合法性：
   - .pi/settings.json 等 JSON 文件是否能正常解析

## 输出章节

```text
## Current state
## Sync issues
## Source/claim risks
## Suggested minimal patch
## Verification checklist
```

## 重点检查项

- result/CLAIMS.md 是否需要同步
- search-source/README.md / topic README / update-log 是否需要同步
- cli-agents/README.md 和具体工具目录是否需要同步
- 是否误把 result/model-outputs/ 当 final doc 引用
- 新增/移动 search-source/ topic 时是否遗漏根 README 和 update-log
- 修改 final docs 强结论时是否遗漏 CLAIMS.md 和对应目录 README 来源映射
- 修改 CLI Agent landing docs 时是否遗漏 cli-agents/README.md 和子目录入口
- 修改 shared templates 或 UI/UX anti-slop 时是否遗漏 team/personal 两侧对齐
- 修改 model-outputs/ 时是否保持 archive / not final 状态标记
