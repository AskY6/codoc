import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { getCredentialStore } from "@codoc/core";

// We need to test loadCredentials with and without encryption key
// Dynamic import to allow env var manipulation between tests

describe("credentials encryption", () => {
  let tempDir: string;
  let docsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cred-test-"));
    docsDir = tempDir;
    await mkdir(join(docsDir, ".cobook"), { recursive: true });
    getCredentialStore().clear();
  });

  afterEach(async () => {
    delete process.env.COBOOK_CREDENTIALS_KEY;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads plaintext credentials when no encryption key", async () => {
    const yaml = `feishu:\n  appId: cli_test\n  appSecret: secret123\n`;
    await writeFile(join(docsDir, ".cobook", "credentials.yaml"), yaml);

    // Import fresh to pick up env
    const { loadCredentials } = await import("../credentials.js");
    await loadCredentials(docsDir);

    const store = getCredentialStore();
    expect(store.has("feishu")).toBe(true);
    const auth = store.get("feishu") as { appId: string; appSecret: string };
    expect(auth.appId).toBe("cli_test");
    expect(auth.appSecret).toBe("secret123");
  });

  it("auto-encrypts plaintext file when encryption key is set", async () => {
    process.env.COBOOK_CREDENTIALS_KEY = "my-secret-key-123";
    const yaml = `feishu:\n  appId: cli_test\n  appSecret: secret123\n`;
    await writeFile(join(docsDir, ".cobook", "credentials.yaml"), yaml);

    const { loadCredentials } = await import("../credentials.js");
    await loadCredentials(docsDir);

    // Credentials should be loaded
    const store = getCredentialStore();
    expect(store.has("feishu")).toBe(true);

    // File should now be encrypted
    const content = await readFile(
      join(docsDir, ".cobook", "credentials.yaml"),
      "utf-8",
    );
    expect(content.trim()).toMatch(/^enc:v1:/);
  });

  it("loads encrypted credentials", async () => {
    process.env.COBOOK_CREDENTIALS_KEY = "my-secret-key-123";
    const yaml = `feishu:\n  appId: cli_enc\n  appSecret: enc_secret\n`;
    await writeFile(join(docsDir, ".cobook", "credentials.yaml"), yaml);

    const { loadCredentials } = await import("../credentials.js");

    // First load encrypts the file
    await loadCredentials(docsDir);
    getCredentialStore().clear();

    // Second load reads encrypted file
    await loadCredentials(docsDir);

    const store = getCredentialStore();
    expect(store.has("feishu")).toBe(true);
    const auth = store.get("feishu") as { appId: string; appSecret: string };
    expect(auth.appId).toBe("cli_enc");
    expect(auth.appSecret).toBe("enc_secret");
  });

  it("silently fails when encrypted file but no key", async () => {
    // First, create an encrypted file
    process.env.COBOOK_CREDENTIALS_KEY = "my-secret-key-123";
    const yaml = `feishu:\n  appId: cli_test\n  appSecret: secret\n`;
    await writeFile(join(docsDir, ".cobook", "credentials.yaml"), yaml);

    const { loadCredentials } = await import("../credentials.js");
    await loadCredentials(docsDir);

    // Verify it's encrypted now
    const content = await readFile(
      join(docsDir, ".cobook", "credentials.yaml"),
      "utf-8",
    );
    expect(content.trim()).toMatch(/^enc:v1:/);

    // Remove key, clear store
    delete process.env.COBOOK_CREDENTIALS_KEY;
    getCredentialStore().clear();

    // Should silently fail (no key to decrypt)
    await loadCredentials(docsDir);
    expect(getCredentialStore().has("feishu")).toBe(false);
  });

  it("saveCredentials writes encrypted when key is set", async () => {
    process.env.COBOOK_CREDENTIALS_KEY = "test-save-key";

    const { saveCredentials } = await import("../credentials.js");
    await saveCredentials(docsDir, "feishu:\n  appId: save_test\n");

    const content = await readFile(
      join(docsDir, ".cobook", "credentials.yaml"),
      "utf-8",
    );
    expect(content.trim()).toMatch(/^enc:v1:/);
  });

  it("saveCredentials writes plaintext when no key", async () => {
    const { saveCredentials } = await import("../credentials.js");
    const yaml = "feishu:\n  appId: save_test\n";
    await saveCredentials(docsDir, yaml);

    const content = await readFile(
      join(docsDir, ".cobook", "credentials.yaml"),
      "utf-8",
    );
    expect(content).toBe(yaml);
  });
});
