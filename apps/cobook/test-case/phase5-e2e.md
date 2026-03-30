# Phase 5 端到端测试方案

## 前置条件

- Dev server 在 `localhost:3000` 上运行（`pnpm dev`）
- `ANTHROPIC_API_KEY` 环境变量已设（agent LLM 调用需要）
- `docs/` 目录含 `yirgacheffe.codoc` + `brew-guide.codoc`
- `agent-browser` 全局安装

## 测试范围

1. **Codoc CRUD**：两个 coffee codoc 的完整生命周期（加载、计算、更新、传播、创建）
2. **Agent 使用**：daemon 自动触发、@mention 显式调用、intent 生命周期
3. **Chat 核心交互**：消息收发、context bar、@mention 自动完成、系统消息

---

## T1: Workspace 加载与 Codoc 发现

### T1.1 API — workspace 索引

```bash
curl -s http://localhost:3000/api/workspace | jq '.docs | length'
# 预期：2

curl -s http://localhost:3000/api/workspace | jq '.docs[].docId'
# 预期："yirgacheffe.codoc", "brew-guide.codoc"

curl -s http://localhost:3000/api/workspace | jq '.graph.edges | length'
# 预期：3（brew-guide 的 3 个 $ref 边）
```

### T1.2 浏览器 — 三栏布局

```bash
agent-browser open http://localhost:3000
agent-browser wait --load networkidle
agent-browser snapshot -i
```

**验证点：**
- [ ] 三栏布局渲染（左栏 Resources、中间 Chat、右栏 Participants）
- [ ] 左栏显示 2 个 codoc 条目（yirgacheffe.codoc, brew-guide.codoc）
- [ ] 左栏底部显示 dependency 统计（3 deps, N fields）
- [ ] 右栏显示 4 个 agent（Codoc, Summary, Info Check, Polish）
- [ ] 中间 chat 显示空状态（"Start a conversation"）
- [ ] 顶部 bar 显示 "Cobook" + view switcher + 面板开关

---

## T2: Codoc 读取 — 字段计算（AI + 跨文档引用）

### T2.1 API — yirgacheffe 字段计算

```bash
curl -s http://localhost:3000/api/docs/yirgacheffe.codoc | jq '.fields | keys'
# 预期：包含 /name, /origin, /variety, /processing, /flavorNotes, /body, /roastLevel, /description

curl -s http://localhost:3000/api/docs/yirgacheffe.codoc | jq '.fields["/name"]'
# 预期：{ "status": "resolved", "value": "Ethiopia Yirgacheffe", "loaderType": "literal" }

# /description 是 $prompt 字段，首次请求触发 AI 计算
# 等待几秒后再查
sleep 8
curl -s http://localhost:3000/api/docs/yirgacheffe.codoc | jq '.fields["/description"]'
# 预期：status 为 "resolved"，value 为非空 AI 生成的品鉴笔记
```

### T2.2 API — brew-guide 跨文档引用

```bash
curl -s http://localhost:3000/api/docs/brew-guide.codoc | jq '.fields["/beanName"]'
# 预期：status "resolved"，value 为 "Ethiopia Yirgacheffe"（来自 $ref yirgacheffe）

curl -s http://localhost:3000/api/docs/brew-guide.codoc | jq '.fields["/beanBody"]'
# 预期：status "resolved"，value 为 "light, clean, tea-like"

curl -s http://localhost:3000/api/docs/brew-guide.codoc | jq '.fields["/beanFlavorNotes"]'
# 预期：status "resolved"，value 为 ["citrus","jasmine","bergamot","black tea","honey"]

sleep 8
curl -s http://localhost:3000/api/docs/brew-guide.codoc | jq '.fields["/tip"]'
# 预期：status "resolved"，value 为 AI 生成的冲泡建议
```

---

## T3: Codoc 更新 — 标脏传播 + 重算

### T3.1 API — 更新 yirgacheffe 字段

```bash
# 更新 body 字段
curl -s -X POST http://localhost:3000/api/docs/yirgacheffe.codoc/field \
  -H 'Content-Type: application/json' \
  -d '{"path": "/body", "action": "update", "value": "full, syrupy, bold"}'
# 预期：{ "ok": true }
```

### T3.2 API — 验证本地传播

```bash
sleep 5
curl -s http://localhost:3000/api/docs/yirgacheffe.codoc | jq '.fields["/body"].value'
# 预期："full, syrupy, bold"

curl -s http://localhost:3000/api/docs/yirgacheffe.codoc | jq '.fields["/description"].status'
# 预期："resolved"（description 依赖 body，已重算）
```

### T3.3 API — 验证跨文档传播

```bash
sleep 5
curl -s http://localhost:3000/api/docs/brew-guide.codoc | jq '.fields["/beanBody"].value'
# 预期："full, syrupy, bold"（通过 $ref 传播）

curl -s http://localhost:3000/api/docs/brew-guide.codoc | jq '.fields["/tip"].status'
# 预期："resolved"（tip 依赖 beanBody，已重算）
```

### T3.4 API — 恢复原始值

```bash
curl -s -X POST http://localhost:3000/api/docs/yirgacheffe.codoc/field \
  -H 'Content-Type: application/json' \
  -d '{"path": "/body", "action": "update", "value": "light, clean, tea-like"}'
# 预期：{ "ok": true }
```

---

## T4: Codoc 创建 + Force

### T4.1 API — 创建新 codoc

```bash
curl -s -X POST http://localhost:3000/api/docs \
  -H 'Content-Type: application/json' \
  -d '{
    "docId": "latte-art.codoc",
    "content": "type:\n  properties:\n    style:\n      type: string\n    difficulty:\n      type: string\n    tip:\n      type: string\n\ndata:\n  style: \"Rosetta\"\n  difficulty: \"intermediate\"\n  tip:\n    $prompt:\n      template: \"Give one tip for pouring a {style} latte art pattern (difficulty: {difficulty}). One sentence.\"\n\nview: |\n  # Latte Art: {style}\n  <InfoRow label=\"Difficulty\">{difficulty}</InfoRow>\n  <AIBlock label=\"Tip\">{tip}</AIBlock>\n"
  }'
# 预期：{ "ok": true, "docId": "latte-art.codoc", "added": ["latte-art.codoc"] }
```

### T4.2 API — 验证 workspace 发现新 doc

```bash
curl -s http://localhost:3000/api/workspace | jq '.docs | length'
# 预期：3
```

### T4.3 API — Force 计算新 doc 字段

```bash
curl -s -X POST http://localhost:3000/api/docs/latte-art.codoc/force
# 预期：返回 force 结果，/tip 字段被 AI 计算

sleep 8
curl -s http://localhost:3000/api/docs/latte-art.codoc | jq '.fields["/tip"]'
# 预期：status "resolved"，value 为 AI 生成的拉花建议
```

### T4.4 浏览器 — 验证左栏更新

```bash
agent-browser open http://localhost:3000
agent-browser wait --load networkidle
agent-browser snapshot -i
# 验证：左栏显示 3 个 codoc
```

### T4.5 清理

```bash
rm /path/to/codoc/apps/cobook/docs/latte-art.codoc
# 下次 rescan 时恢复到 2 doc 状态
```

---

## T5: Chat 核心交互

### T5.1 浏览器 — Reference codoc + 发送消息

```bash
agent-browser open http://localhost:3000
agent-browser wait --load networkidle
agent-browser snapshot -i

# 点击左栏 yirgacheffe.codoc 添加 reference
agent-browser click @e{yirgacheffe}
agent-browser wait 1000
agent-browser snapshot -i
# 验证：context bar 出现，显示 "yirgacheffe.codoc" badge
```

### T5.2 浏览器 — 发送普通消息

```bash
# 在输入框输入消息
agent-browser fill @e{textarea} "这款咖啡的风味特点是什么？"
agent-browser snapshot -i
# 验证：输入框有内容，发送按钮可用

# 点击发送
agent-browser click @e{send}
agent-browser wait --load networkidle
agent-browser wait 3000
agent-browser snapshot -i
# 验证：
# - 用户消息出现在消息流中，显示 "You" + 头像
# - codoc-agent（daemon）可能自动响应（因为有 codoc resource ref）
```

### T5.3 浏览器 — 验证 agent 响应

```bash
# 等待 agent 响应（LLM 调用需要时间）
agent-browser wait 10000
agent-browser snapshot -i
# 验证：
# - agent 回复出现，显示具名 sender（如 "Codoc"）
# - agent 头像颜色与 agent 类型匹配
# - 如果有 intent，IntentCard 渲染为蓝色 "proposed" 状态
```

---

## T6: Agent @mention 触发

### T6.1 浏览器 — @mention autocomplete

```bash
# 输入 @ 触发 mention dropdown
agent-browser fill @e{textarea} "@sum"
agent-browser wait 500
agent-browser snapshot -i
# 验证：mention dropdown 出现，显示 "Summary" agent 选项

# 选择 summary-agent
agent-browser click @e{summary-option}
agent-browser wait 500
agent-browser snapshot -i
# 验证：输入框中出现 "@summary-agent "
```

### T6.2 浏览器 — 发送 @mention 消息

```bash
# 补全消息并发送
agent-browser fill @e{textarea} "@summary-agent 总结一下这款咖啡的核心特征"
agent-browser click @e{send}
agent-browser wait --load networkidle

# 等待 summary-agent 响应
agent-browser wait 15000
agent-browser snapshot -i
# 验证：
# - 用户消息出现
# - summary-agent 回复出现，sender 显示 "Summary" + 紫色头像
# - 回复内容为结构化总结
```

---

## T7: Intent 生命周期

### T7.1 API — 触发含 intent 的 agent 响应

```bash
# 先确保有 codoc reference
curl -s -X POST http://localhost:3000/api/chat/reference \
  -H 'Content-Type: application/json' \
  -d '{"kind": "codoc", "id": "yirgacheffe.codoc", "label": "yirgacheffe.codoc"}'

# 发送 @polish-agent 消息
curl -s -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"content": "@polish-agent 帮我润色 description 字段的内容", "mentionedParticipants": ["polish-agent"], "resourceRefs": [{"kind": "codoc", "id": "yirgacheffe.codoc"}]}'
# 预期：返回用户消息 JSON

# 等待 agent 响应
sleep 15
```

### T7.2 API — 验证 agent 回复含 intent

```bash
curl -s http://localhost:3000/api/chat | jq '.messages[-1]'
# 预期：最后一条消息 sender.id 为 "polish-agent"
# 预期：intents 数组非空，包含 kind "write-codoc-field"，status "proposed"
```

### T7.3 浏览器 — IntentCard 交互

```bash
agent-browser open http://localhost:3000
agent-browser wait --load networkidle
agent-browser wait 3000
agent-browser snapshot -i
# 验证：
# - IntentCard 渲染为蓝色 "proposed" 状态
# - 显示 "Write to yirgacheffe.codoc field /description"
# - 有 Confirm 和 Reject 按钮
# - 预览区显示润色后的值

# 点击 Confirm
agent-browser click @e{confirm}
agent-browser wait 5000
agent-browser snapshot -i
# 验证：
# - IntentCard 状态变为绿色 "confirmed"
# - 系统消息出现（"field changed"）
```

### T7.4 API — 验证字段已写入

```bash
curl -s http://localhost:3000/api/docs/yirgacheffe.codoc | jq '.fields["/description"]'
# 预期：status "resolved"，value 为润色后的新内容（非原始值）
```

---

## T8: 恢复清理

```bash
# 恢复 yirgacheffe body（如果 T3 没恢复）
curl -s -X POST http://localhost:3000/api/docs/yirgacheffe.codoc/field \
  -H 'Content-Type: application/json' \
  -d '{"path": "/body", "action": "update", "value": "light, clean, tea-like"}'

# Force 重算 description（恢复 AI 原始生成值）
curl -s -X POST http://localhost:3000/api/docs/yirgacheffe.codoc/field \
  -H 'Content-Type: application/json' \
  -d '{"path": "/description", "action": "reforce"}'

# 删除测试创建的 codoc（如果 T4 没清理）
rm -f /Users/kxzhang/code/local-tool/codoc/apps/cobook/docs/latte-art.codoc

# 关闭浏览器
agent-browser close
```

---

## 执行策略

```
T1–T4（API 优先）           T5–T7（浏览器交互）           T8（清理）
  │                            │                            │
  ├─ T1: 加载发现              ├─ T5: reference + 发消息     ├─ 恢复字段
  ├─ T2: 字段计算（AI+ref）    ├─ T6: @mention 触发          ├─ 删临时文件
  ├─ T3: 更新 + 传播           ├─ T7: intent 确认            └─ 关浏览器
  └─ T4: 创建 + force          │
                               └─ 每步失败 → 诊断 → 修代码 → 重验证
```

**关键链路**（必须通过）：
- **T2**：证明 codoc 计算引擎工作（$prompt + $ref）
- **T3**：证明标脏传播链路完整（update → propagate → recompute）
- **T5+T6**：证明 chat UI 可用（消息 + reference + agent 响应）
- **T7**：证明 intent 全链路闭环（agent → propose → confirm → write → notify）
