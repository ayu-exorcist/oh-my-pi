---
name: ui-ux-guard
description: Detailed UI/UX constraints and anti-AI-slop rules. Use when the task involves frontend design, design-to-code, mockup restoration, or creating user-facing interfaces.
---

# UI/UX Guard

## When to use

- The task involves UI/UX design, frontend implementation, or visual changes.
- The task requires restoring a design mockup or screenshot to code.
- The task creates new user-facing pages or components.

## Rules

### Design context first

- Read `docs/DESIGN.md` first; if missing, suggest creating a minimal DESIGN.md before designing.
- Design mockup restoration must fix reference image, viewport, mock data, and acceptance criteria.
- Do not guess layout from node names without design context.

### Incremental changes

- Change one area at a time; fix skeleton first, then module relationships, then details and responsiveness.

### Design tokens

- Prefer design tokens for colors, font sizes, spacing, radius, and shadows.
- Avoid unexplained raw hex or arbitrary px values.

### Anti-AI-Slop checklist

Avoid these patterns:

- Purple/blue gradient backgrounds unrelated to brand.
- White rounded cards + shadows without information hierarchy.
- Three identical feature columns.
- Decorative icons (stars, magic wands, robots).
- Unconscious default fonts (Inter/Roboto/Arial/system default).
- Generic marketing copy ("boost efficiency", "unlock potential", "intelligent experience").
- Center-aligned body text without reason.
- Missing hover/focus/disabled/loading/error/empty states.

### Verification

- After UI tasks, supplement with screenshot/visual diff/a11y/responsive verification.
