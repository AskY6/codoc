# Codoc Use 设计

Codoc Use 是对 `@packages/core` 的适配层，将 CoDoc Core 的能力翻译为 Chat Ability 世界的原语。它不定义 agent，不包含 UI，不管理 session。它只回答一个问题：**codoc 在 chat 中如何被引用、被理解、被操作、被感知。**

依赖：
- **Chat Ability** — ResourceRef、ContextSource、Intent 等原语
- **CoDoc Core (Workspace API)** — listDocs、loadDoc、onFieldChange、CodocRuntime

---

## 一、资源适配：codoc 如何被引用

### 1.1 ResourceRef 注册

将 codoc 注册为 Chat Ability 的资源类型：

```typescript
const codocResource: ResourceRef = {
  kind: "codoc",
  id: "report.codoc",
  label: "Report",
};
```

用户在 chat 中 @mention 一个 codoc，本质上是在消息中附加一个 `ResourceRef { kind: "codoc" }`。Chat Ability 不知道 codoc 是什么，只负责传递这个 ref。

### 1.2 资源索引提供

Codoc Use 向 UI 层暴露 workspace 的 codoc 索引，供 Resources panel 展示和搜索：

```typescript
function listCodocResources(workspace: Workspace): ResourceRef[] {
  return workspace.listDocs().map(meta => ({
    kind: "codoc",
    id: meta.id,
    label: meta.name ?? meta.id,
  }));
}
```

---

## 二、上下文适配：codoc 如何被理解

### 2.1 ContextSource 工厂

将 codoc 的 schema + 值注册为上下文源：

```typescript
function createCodocContextSource(workspace: Workspace, docId: string): ContextSource {
  return {
    kind: "codoc-snapshot",
    async resolve() {
      const runtime = await workspace.loadDoc(docId);
      const meta = workspace.listDocs().find(d => d.id === docId);
      return {
        kind: "codoc-snapshot",
        content: serializeCodocForLLM(meta, runtime),
        tokens: estimateTokens(...),
      };
    },
  };
}
```

当用户 reference 一个 codoc 进 chat，Codoc Use 自动注册对应的 `ContextSource` 到当前 session。任何 agent 如果在 `contextRequirements` 中声明了 `codoc-snapshot`，上下文组装会自动 resolve 这些源。

### 2.2 序列化策略

codoc 序列化为 LLM 可理解的文本：

```typescript
function serializeCodocForLLM(meta: DocMeta, runtime: CodocRuntime): string {
  const lines: string[] = [];
  lines.push(`## ${meta.id}`);
  lines.push(`Schema:`);
  lines.push("```json");
  lines.push(JSON.stringify(meta.schema, null, 2));
  lines.push("```");
  lines.push(`Current values:`);
  for (const [field, value] of runtime.observeAll()) {
    lines.push(`- \`${field}\`: ${JSON.stringify(value)}`);
  }
  return lines.join("\n");
}
```

### 2.3 多 codoc 上下文预算

当 session 中 reference 了多个 codoc，且总 token 超预算时：

1. 用户显式 quote 的 codoc 优先（全量保留）
2. 最近 reference 的 codoc 次之
3. 早期 reference 的 codoc 裁剪为 schema-only（不含值）

---

## 三、操作适配：codoc 如何被操作

### 3.1 Intent 类型定义

Codoc Use 定义 codoc 相关的 intent 类型：

```typescript
type CodocIntentKind =
  | "write-codoc-field"    // 写入 codoc 字段
  | "create-codoc"         // 创建新 codoc
  | "delete-codoc"         // 删除 codoc
  | "force-codoc-field";   // 强制重新计算 codoc 字段
```

这些 intent 由 agent 在消息中提出（`status: "proposed"`），Codoc Use 不关心是哪个 agent 提的。

### 3.2 Intent 执行器

监听 Chat Ability 的 `onIntentStatusChange` 事件，当 codoc 相关 intent 变为 `confirmed` 时通过 Workspace API 执行：

```typescript
function executeCodocIntent(workspace: Workspace, intent: Intent) {
  switch (intent.kind) {
    case "write-codoc-field": {
      const { docId, field, value } = intent.payload as WriteFieldPayload;
      const runtime = workspace.loadDoc(docId);
      runtime.write(field, value);
      break;
    }
    case "force-codoc-field": {
      const { docId, field } = intent.payload as ForceFieldPayload;
      const runtime = workspace.loadDoc(docId);
      runtime.force(field);
      break;
    }
    // ... create / delete
  }
}
```

### 3.3 写权限模型

Codoc Use 提供写入能力，但**不做权限控制**。谁有权发起写入 intent、谁有权 confirm intent，是 agent 层和 UI 层的决策，不是 Codoc Use 的职责。Codoc Use 只保证：confirmed intent → 正确执行 Workspace API 调用。

---

## 四、事件适配：codoc 变更如何被感知

### 4.1 Workspace 事件桥接

CoDoc Core 的 Workspace 会发出字段变更事件。Codoc Use 将这些事件翻译为 chat 系统消息：

```typescript
function bridgeWorkspaceEvents(workspace: Workspace, chat: ChatAbility, sessionId: string) {
  workspace.onFieldChange((event) => {
    chat.sendMessage(sessionId, {
      sender: { participantId: "system" },
      content: `codoc **${event.docId}** 的字段 \`${event.fieldPath}\` 已变更。`,
      resourceRefs: [{ kind: "codoc", id: event.docId }],
      intents: [],
    });

    for (const downstream of event.staleDownstream) {
      chat.sendMessage(sessionId, {
        sender: { participantId: "system" },
        content: `下游 codoc **${downstream.docId}** 的字段 \`${downstream.fieldPath}\` 已标记为 stale。`,
        resourceRefs: [{ kind: "codoc", id: downstream.docId }],
        intents: [],
      });
    }
  });
}
```

事件进入 Chat Bus 后，Codoc Use 不关心谁来响应。daemon agent 是否响应 stale 通知，是 agent 的决策。

### 4.2 Staleness 状态查询

Codoc Use 暴露 codoc 字段的 staleness 状态查询能力，供 UI 层在 Resource 卡片上标记：

```typescript
function isFieldStale(workspace: Workspace, docId: string, fieldPath: string): boolean;
```

---

## 五、初始化接口

Codoc Use 的全部能力通过一次初始化调用注入 session：

```typescript
function initCodocUse(workspace: Workspace, chat: ChatAbility, sessionId: string) {
  // 注册 codoc-snapshot ContextSource 工厂
  chat.registerContextSourceFactory(sessionId, {
    kind: "codoc-snapshot",
    create: (resourceRef) => createCodocContextSource(workspace, resourceRef.id),
  });

  // 注册 codoc intent 执行器
  chat.on(sessionId, "onIntentStatusChange", (msgId, idx, status) => {
    if (status === "confirmed") {
      const intent = chat.getIntent(sessionId, msgId, idx);
      if (isCodocIntent(intent)) executeCodocIntent(workspace, intent);
    }
  });

  // 桥接 workspace 事件
  bridgeWorkspaceEvents(workspace, chat, sessionId);
}
```

---

## 六、Codoc Use 的边界

Codoc Use **做**的事情：
- 将 codoc 适配为 ResourceRef（资源引用）
- 将 codoc schema + 值适配为 ContextSource（上下文源）
- 定义并执行 codoc 相关的 Intent 类型
- 桥接 workspace 字段变更事件到 chat 系统消息
- 提供 codoc 序列化和 staleness 查询

Codoc Use **不做**的事情：
- 不定义 agent（那是 Agents 层的事）
- 不决定谁有写权限（那是 agent 定义和 UI 的事）
- 不管理 UI（没有 React 组件）
- 不管理 chat 消息路由（那是 Chat Ability 的事）
- 不管理 session 生命周期（那是 Cobook Workspace 的事）
