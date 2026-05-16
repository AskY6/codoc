// RSS plugin — UI bundle entry. Re-exports panel components that the host's
// plugin-view registry wires into the SPA. Phase 2 will replace this with
// `activateUi(ctx)` and dynamic registration via `ctx.views.registerView`.

export { SubscriptionsPanel } from "./panels/SubscriptionsPanel.tsx";
export { SavedArticlesPanel } from "./panels/SavedArticlesPanel.tsx";
