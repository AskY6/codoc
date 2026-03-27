import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { setLLMClient } from "@codoc/core";
import { MultiDocRuntime } from "./runtime.js";
import { mockLLMClient } from "./mock-llm.js";
import { App } from "./App.js";
import docASource from "./m4-demo-a.codoc?raw";
import docBSource from "./m4-demo-b.codoc?raw";

async function boot() {
  setLLMClient(mockLLMClient);

  const multi = new MultiDocRuntime();
  const rtB = multi.addDoc("B.codoc", docBSource);
  const rtA = multi.addDoc("A.codoc", docASource);
  multi.wireAll();

  (window as unknown as Record<string, unknown>).codoc = multi;

  const t0 = performance.now();
  await multi.forceAll();
  console.log(`[M4] forceAll completed in ${(performance.now() - t0).toFixed(0)}ms`);

  const [mdxB, mdxA] = await Promise.all([
    evaluate(rtB.preprocessView(), { ...runtime, development: false }),
    evaluate(rtA.preprocessView(), { ...runtime, development: false }),
  ]);

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <App
        multi={multi}
        docs={[
          { docId: "B.codoc", runtime: rtB, rawSource: docBSource, role: "provider", MDXContent: mdxB.default },
          { docId: "A.codoc", runtime: rtA, rawSource: docASource, role: "consumer", MDXContent: mdxA.default },
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
