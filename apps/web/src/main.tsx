import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { setLLMClient } from "@codoc/core";
import { MultiDocRuntime } from "./runtime/runtime.js";
import { mockLLMClient } from "./runtime/mock-llm.js";
import { App } from "./App.js";
import { CodataValue } from "./runtime/codata-react.js";
import {
  Badge,
  PriceDisplay,
  InfoRow,
  SourceBlock,
  AIBlock,
  Highlight,
} from "./components/mdx-components.js";
import productSource from "./docs/product.codoc?raw";
import userSource from "./docs/user.codoc?raw";
import orderSource from "./docs/order.codoc?raw";

const mdxComponents = {
  CodataValue,
  Badge,
  PriceDisplay,
  InfoRow,
  SourceBlock,
  AIBlock,
  Highlight,
};

async function boot() {
  setLLMClient(mockLLMClient);

  const multi = new MultiDocRuntime();
  const rtProduct = multi.addDoc("product.codoc", productSource);
  const rtUser = multi.addDoc("user.codoc", userSource);
  const rtOrder = multi.addDoc("order.codoc", orderSource);
  multi.wireAll();

  (window as unknown as Record<string, unknown>).codoc = multi;

  const t0 = performance.now();
  await multi.forceAll();
  console.log(`[boot] forceAll completed in ${(performance.now() - t0).toFixed(0)}ms`);

  // Start TTL refresh timers — $source fields will auto-invalidate on expiry
  multi.startSchedulers();

  const [mdxProduct, mdxUser, mdxOrder] = await Promise.all([
    evaluate(rtProduct.preprocessView(), { ...runtime, development: false }),
    evaluate(rtUser.preprocessView(), { ...runtime, development: false }),
    evaluate(rtOrder.preprocessView(), { ...runtime, development: false }),
  ]);

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <App
        multi={multi}
        docs={[
          {
            docId: "product.codoc", runtime: rtProduct, rawSource: productSource, role: "provider",
            MDXContent: mdxProduct.default, mdxComponents,
            ops: [
              { label: 'name → "iPad Air"', action: () => multi.update("product.codoc", "/name", "iPad Air") },
              { label: "price → 599", action: () => multi.update("product.codoc", "/price", 599) },
              { label: "refresh stock", action: () => rtProduct.refresh("/stock") },
            ],
          },
          {
            docId: "user.codoc", runtime: rtUser, rawSource: userSource, role: "provider",
            MDXContent: mdxUser.default, mdxComponents,
            ops: [
              { label: 'name → "Bob Li"', action: () => multi.update("user.codoc", "/name", "Bob Li") },
              { label: 'role → "VIP"', action: () => multi.update("user.codoc", "/role", "VIP") },
              { label: "refresh activity", action: () => rtUser.refresh("/recentActivity") },
            ],
          },
          {
            docId: "order.codoc", runtime: rtOrder, rawSource: orderSource, role: "consumer",
            MDXContent: mdxOrder.default, mdxComponents,
            ops: [
              { label: "qty → 5", action: () => multi.update("order.codoc", "/quantity", 5) },
              { label: "forceAll", action: () => rtOrder.forceAll() },
            ],
          },
        ]}
      />
    </StrictMode>,
  );
}

boot().catch((err) => {
  document.getElementById("root")!.innerHTML = `
    <div style="color:#cc0000;background:#fff0f0;padding:12px;border-radius:4px;border:1px solid #ffcccc">
      <strong>Boot failed:</strong> ${err.message}
    </div>
  `;
  console.error(err);
});
