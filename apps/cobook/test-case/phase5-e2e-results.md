# Phase 5 端到端测试结果

**执行日期**: 2026-03-29
**环境**: localhost:3000 (Next.js dev server), agent-browser

---

## 总览

| 测试 | 描述 | 结果 | 备注 |
|------|------|------|------|
| T1.1 | Workspace API: 2 docs, graph edges | ✅ PASS | graph edges = 10（含 $prompt 依赖边），方案预期 3 |
| T1.2 | 三栏布局、2 codoc、4 agent、空状态 | ✅ PASS | 所有元素正确渲染 |
| T2.1 | yirgacheffe 字段计算（literal + $prompt） | ✅ PASS | /description 首次访问即 AI 生成 |
| T2.2 | brew-guide $ref 跨文档引用 | ✅ PASS | $ref 字段初始为 pending，需 /force 触发解析 |
| T3.1–3.4 | 更新字段 → 标脏 → 传播 → 跨文档重算 | ✅ PASS | 完整传播链路正常 |
| T4.1–4.4 | 创建 codoc、workspace 发现、force 计算 | ✅ PASS | CRUD 全流程正常 |
| T5.1–5.3 | Chat 消息发送 + daemon 自动响应 | ⚠️ PARTIAL | 消息发送正常，但 daemon 未触发（BUG-2） |
| T6.1–6.2 | @mention 自动完成 + summary-agent 响应 | ✅ PASS | @mention 全流程正常 |
| T7.1–7.4 | Intent 生命周期: propose → confirm → write → notify | ✅ PASS | 完整闭环确认 |

**关键链路判定**:
- T2（codoc 计算引擎）✅
- T3（标脏传播链路）✅
- T5+T6（chat UI 可用性）⚠️ T5 有 BUG，T6 正常
- T7（intent 全链路闭环）✅

---

## T1: Workspace 加载与 Codoc 发现

### T1.1 API — workspace 索引 ✅

```
docs | length = 2                            ✅ 预期 2
docIds = [brew-guide.codoc, yirgacheffe.codoc] ✅
graph.edges | length = 10                    ⚠️ 预期 3
```

graph 包含 3 条 `$ref` 边 + 7 条 `$prompt` 模板依赖边，共 10 条。测试方案只预期了 `$ref` 边，实际实现把 prompt 模板中引用的字段也建了依赖边。结构正确，数量比预期多。

### T1.2 浏览器 — 三栏布局 ✅

- [x] 三栏布局渲染（左栏 RESOURCES、中间 Chat、右栏 PARTICIPANTS）
- [x] 左栏显示 2 个 codoc（brew-guide.codoc, yirgacheffe.codoc）
- [x] 左栏底部显示统计（"10 deps  20 fields"）
- [x] 右栏显示 4 个 agent（Codoc daemon, Summary, Info Check, Polish）
- [x] 中间 chat 显示空状态（"Start a conversation"）
- [x] 顶部 bar 显示 "Cobook" + 面板开关按钮

**额外观察**: CONTEXT bar 默认已显示所有 codoc，说明初始化时自动添加了全部 codoc 作为 active resource refs。

---

## T2: Codoc 读取 — 字段计算

### T2.1 API — yirgacheffe 字段计算 ✅

```json
// /name
{ "status": "resolved", "loaderType": "literal", "value": "Ethiopia Yirgacheffe" }

// /description ($prompt)
{ "status": "resolved", "loaderType": "prompt", "value": "...AI 生成的品鉴笔记..." }
```

字段 keys 包含所有预期路径：`/name, /origin, /variety, /processing, /flavorNotes, /body, /roastLevel, /description`。

### T2.2 API — brew-guide 跨文档引用 ✅

初始状态 `$ref` 字段为 `pending`（懒加载），调用 `/force` 后全部解析：

```json
// /beanName
{ "status": "resolved", "loaderType": "external", "value": "Ethiopia Yirgacheffe" }

// /beanBody
{ "status": "resolved", "loaderType": "external", "value": "light, clean, tea-like" }

// /beanFlavorNotes
{ "status": "resolved", "loaderType": "external", "value": ["citrus","jasmine","bergamot","black tea","honey"] }

// /tip ($prompt，依赖 $ref 字段)
{ "status": "resolved", "loaderType": "prompt", "value": "...AI 生成的冲泡建议..." }
```

**注意**: `$ref` 字段默认懒加载（pending），需要 `/force` 触发。这是设计行为，但测试方案预期直接 GET 就能拿到 resolved 值。

---

## T3: Codoc 更新 — 标脏传播 + 重算 ✅

### T3.1 更新 yirgacheffe /body

```
POST /field { path: "/body", value: "full, syrupy, bold" } → { ok: true }
```

### T3.2 本地传播

```
/body.value = "full, syrupy, bold"        ✅ 已更新
/description.status = "resolved"          ✅ 已重算（依赖 body）
```

### T3.3 跨文档传播

```
brew-guide /beanBody.value = "full, syrupy, bold"   ✅ 通过 $ref 传播
brew-guide /tip.status = "resolved"                  ✅ 已重算（依赖 beanBody）
```

### T3.4 恢复原始值

```
POST /field { path: "/body", value: "light, clean, tea-like" } → { ok: true }
```

---

## T4: Codoc 创建 + Force ✅

### T4.1 创建新 codoc

```json
POST /api/docs { docId: "latte-art.codoc", content: "..." }
→ { "ok": true, "docId": "latte-art.codoc", "added": ["latte-art.codoc"] }
```

### T4.2 Workspace 发现

```
docs | length = 3                                                  ✅
docIds = [brew-guide.codoc, yirgacheffe.codoc, latte-art.codoc]    ✅
```

### T4.3 Force 计算

```json
POST /api/docs/latte-art.codoc/force
→ { "resolved": ["/style", "/difficulty", "/tip"], "errors": [] }

// /tip
{ "status": "resolved", "loaderType": "prompt",
  "value": "Wiggle the pitcher tip back and forth in a steady rhythm..." }
```

### T4.4 浏览器验证

左栏正确显示 3 个 codoc ✅

---

## T5: Chat 核心交互 ⚠️ PARTIAL

### T5.1–5.2 消息发送 ✅

- 用户消息在 chat 中正确渲染（"You" + 时间戳 + 内容）
- 输入框有内容时发送按钮启用

### T5.3 Agent 响应 ❌ — BUG-2

用户通过 UI 发送纯文本消息 "这款咖啡的风味特点是什么？"，daemon **未触发**。

**原因**: `ChatInput.tsx:handleSend` 只从 `@mention` 文本中提取 resource refs，**不会自动附带 context bar 中的 active resource refs**。消息以 `resourceRefs: []` 发出，不满足 daemon 的 `resourceKinds: ["codoc"]` 过滤条件。

通过 API 手动附加 `resourceRefs` 后，daemon 正常触发并响应。

---

## T6: Agent @mention 触发 ✅

### T6.1 @mention 自动完成

```
输入 "@sum" → dropdown 出现 "Summary agent" 选项     ✅
点击选项 → 输入框插入 "@summary-agent "               ✅
```

### T6.2 发送 @mention 消息

```
发送: "@summary-agent 总结一下 yirgacheffe 咖啡的核心特征"
→ mentionedParticipants: ["summary-agent"]             ✅
→ summary-agent 回复: 结构化中文总结（产地、风味、处理方式、品种、烘焙建议） ✅
→ sender: { id: "summary-agent", kind: "agent" }       ✅
```

---

## T7: Intent 生命周期 ✅

### T7.1 触发 polish-agent

```
前置: 通过 /api/chat/reference 注册 yirgacheffe.codoc 到 session
发送: "@polish-agent 帮我润色 description 字段的内容，让它更精炼有诗意"
```

### T7.2 Agent 回复含 intent

```json
{
  "sender": { "id": "polish-agent", "kind": "agent" },
  "intents": [{
    "kind": "write-codoc-field",
    "status": "proposed",
    "payload": {
      "docId": "yirgacheffe.codoc",
      "field": "/description",
      "value": "**Ethiopia Yirgacheffe** — 明亮的柑橘与茉莉花香交织升腾，化为细腻的佛手柑与悠长红茶余韵，蜜意轻抚，杯中盛着一份清澈而从容的雅致。"
    }
  }]
}
```

### T7.3 IntentCard 交互

- [x] IntentCard 渲染为蓝色 "proposed" 状态
- [x] 显示 "Write to yirgacheffe.codoc field /description"
- [x] 预览区显示润色后的值
- [x] Confirm / Reject 按钮可点击
- [x] 点击 Confirm 后 → 状态变为绿色 "confirmed"
- [x] 系统消息出现: `codoc **yirgacheffe.codoc** field '/description' changed.`

### T7.4 字段已写入

```json
{
  "status": "resolved",
  "loaderType": "literal",    // 从 "prompt" 变为 "literal"（被覆写）
  "value": "**Ethiopia Yirgacheffe** — 明亮的柑橘与茉莉花香交织升腾..."
}
```

---

## 发现的 Bug

### BUG-1: Daemon 消息洪水 (High)

**位置**: `codoc-use/events.ts` + `chat/bus.ts`

**现象**: Workspace 操作期间（T1–T4），chat 中累积了 126+ 条消息，DOM 中出现 ~115 对 Confirm/Reject 按钮，页面几乎不可用。

**原因分析**:
1. 每个字段变更都单独发一条 system message（无 batching）
2. Daemon cooldown 仅 1 秒（`cooldownMs: 1000`），API 调用间隔大于 1 秒时 daemon 会逐条响应
3. Daemon 响应本身可能再次触发 field change → 级联效应

**修复建议**:
- 对 `bridgeWorkspaceEvents` 添加时间窗口 batching（如 2–3 秒内的 field change 合并为一条 system message）
- 增大 daemon cooldown 至 5–10 秒
- 或仅对 user 消息触发 daemon，system 消息不触发

### BUG-2: 用户消息缺失 resource refs (Medium)

**位置**: `workspace/components/ChatInput.tsx:handleSend()`

**现象**: 用户在 UI 中输入纯文本消息（无 @mention），发出的消息 `resourceRefs: []`，即使 context bar 中已有 codoc 引用。导致 daemon 不触发。

**原因**: `handleSend` 通过 `extractMentions(text)` 只提取文本中 `@` 开头的引用，不会合并 session 中已有的 `activeResourceRefs`。

**修复建议**: 在 `handleSend` 中，从 chat store 获取当前 active refs，与文本提取的 refs 合并后一起发送：

```typescript
const { mentioned, resourceRefs: mentionRefs } = extractMentions(text);
const activeRefs = getChatStore().getReferences();  // 当前 context bar 中的 refs
const allRefs = [...activeRefs, ...mentionRefs.filter(r => !activeRefs.some(a => a.id === r.id))];

await sendChatMessage(text, {
  mentionedParticipants: mentioned.length > 0 ? mentioned : undefined,
  resourceRefs: allRefs.length > 0 ? allRefs : undefined,
});
```

### BUG-3: Agent 首次响应无 codoc 上下文 (Low)

**现象**: 通过 API 首次发送带 `resourceRefs` 的消息时，codoc-agent 回复 "没有收到该文档的具体字段内容"。

**原因**: Context assembly（`assembleContext`）使用 `session.activeResourceRefs` 而非 message 上的 `resourceRefs`。如果没有通过 `/api/chat/reference` 预先注册 ref 到 session，context 源工厂找不到对应的 codoc snapshot。

**关联**: 与 BUG-2 同源——resource refs 在 message 和 session 两个层面不同步。

**修复建议**: 在 `sendMessage` 或 `routeMessage` 中，将 message 上的 `resourceRefs` 自动合并到 `session.activeResourceRefs`。

---

## 额外观察

1. **$ref 字段懒加载**: brew-guide 的 `$ref` 字段初始为 `pending`，需要 `/force` 才能解析。测试方案预期 GET 即可拿到 resolved 值。如果这是设计行为，测试方案需更新；如果期望 eager 解析，需要在 workspace 初始化时自动 force 所有 `$ref` 字段。

2. **Graph edges 包含 prompt 依赖**: 测试方案预期 3 条 `$ref` 边，实际 graph 把 `$prompt` 模板中的字段引用也建了边（共 10 条）。这是更完整的依赖图，但测试预期需更新。

3. **Intent 确认后级联**: 确认 polish-agent 的 write intent 后，field change 通知触发 codoc-agent 再次提出 force-refresh intent。这是 BUG-1 的一个子场景——intent 确认 → 字段写入 → system message → daemon 响应 → 新 intent。
