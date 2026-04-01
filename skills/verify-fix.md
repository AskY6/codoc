---
name: verify-fix
description: Closed-loop development verification. Use after implementing a feature or fixing a bug to verify the result in the browser, then fix any issues found. Triggers include "verify", "验证一下", "check if it works", "看看效果", "verify and fix", "闭环验证", "test the page", "does it render correctly", or any request to visually confirm that code changes work in the running app.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(curl:*), Bash(pnpm:*), Bash(lsof:*), Read, Edit, Write, Glob, Grep
---

# Verify-Fix Loop

Closed-loop workflow: verify a feature in the browser with agent-browser, identify issues, fix code, re-verify until correct.

## Prerequisites

- Dev server running on `http://localhost:3000` (Next.js)
- `agent-browser` installed globally

## Loop Protocol

Every verify-fix cycle follows this exact sequence:

### Phase 1: Ensure Environment

```bash
# Check if dev server is running
lsof -i :3000 -sTCP:LISTEN
# If not running, start it (in background)
# cd /Users/kxzhang/code/local-tool/skill-flow && pnpm dev
```

### Phase 2: Verify

```bash
# 1. Open the target page
agent-browser open http://localhost:3000{route}

# 2. Wait for full render
agent-browser wait --load networkidle

# 3. Take structural snapshot (primary signal)
agent-browser snapshot -i

# 4. Take annotated screenshot (visual signal, use when layout/style matters)
agent-browser screenshot --annotate
```

Read the snapshot output carefully. Check:
- **Structure**: Are expected elements present? Correct hierarchy?
- **Content**: Are labels, text, data values correct?
- **State**: Loading spinners gone? Error messages absent? Empty states handled?

### Phase 3: Interact & Diff

When verifying interactive features, interact and diff:

```bash
# Interact with elements using refs from snapshot
agent-browser fill @e{N} "test input"
agent-browser click @e{N}

# Wait for response
agent-browser wait --load networkidle

# Diff against pre-interaction state
agent-browser diff snapshot
```

The diff shows `+` additions and `-` removals. Use this to judge whether the interaction produced the expected DOM change.

For API-dependent features, also check network:

```bash
agent-browser network requests --type xhr,fetch
```

### Phase 4: Diagnose

If issues are found:

1. **Identify the symptom** from snapshot/screenshot (missing element, wrong text, error message, layout broken)
2. **Trace to code** — read the relevant component/API route
3. **Fix the code** — edit the source file
4. **Go back to Phase 2** — re-verify

### Phase 5: Close

After successful verification:

```bash
agent-browser close
```

## Verification Checklist

Use this mental checklist for each page:

- [ ] Page loads without errors (no error boundary, no 500)
- [ ] Key elements render (headings, lists, cards, buttons)
- [ ] Data fetches succeed (list not empty when data exists, loading states resolve)
- [ ] Interactive elements respond (click, fill, submit produce expected changes)
- [ ] Navigation works (links go to correct routes)
- [ ] Edge cases handled (empty state, long text, missing optional fields)

## Route Reference (SkillFlow)

| Route | Key Elements |
|---|---|
| `/skills` | Skill cards, search input, maturity filter, tag chips |
| `/skills/[id]` | Skill name, steps list, pitfalls, variables, edit/export buttons |
| `/skills/[id]/edit` | Form fields, save button, step editor, pitfall editor |
| `/creator` | Mode cards (paste enabled, others disabled) |
| `/creator/paste` | Textarea, format selector, submit button |
| `/creator/distill` | Streaming output, skill structure preview |
| `/tasks` | Task list, status badges |
| `/tasks/new` | Task creation form |
| `/tasks/[id]` | Task detail, step progress, feedback |

## Common Patterns

### Verify a list page renders

```bash
agent-browser open http://localhost:3000/skills && agent-browser wait --load networkidle && agent-browser snapshot -i
# Check: skill cards present, count matches expected data
```

### Verify form submission

```bash
agent-browser open http://localhost:3000/creator/paste
agent-browser wait --load networkidle
agent-browser snapshot -i
# Fill form
agent-browser fill @e{textarea} "paste content here"
agent-browser click @e{submit}
# Verify redirect or result
agent-browser wait --url "**/distill"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

### Verify after a code fix (re-verify)

```bash
# After editing source code, Next.js hot-reloads automatically
# Wait a moment for HMR, then re-snapshot
agent-browser wait 2000
agent-browser snapshot -i
agent-browser diff snapshot
# diff shows what changed after the fix
```

### Verify API response

```bash
curl -s http://localhost:3000/api/skills | head -c 500
# Check JSON structure matches expected schema
```

## Rules

1. **Snapshot first, screenshot second.** Snapshot is the primary signal (structured, parseable). Screenshot is supplementary (visual layout, style issues).
2. **Always diff after interaction.** Never assume a click/fill worked — verify with `diff snapshot`.
3. **One issue at a time.** Fix the most critical issue, re-verify, then move to the next.
4. **Read before fixing.** Always read the relevant source file before editing — don't guess.
5. **Re-verify after every fix.** The loop is not done until verification passes clean.
6. **Close the browser when done.** Avoid leaked processes.
