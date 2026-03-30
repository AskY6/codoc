import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { getCredentialStore } from "@codoc/source";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTED_PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer | null {
  const raw = process.env.COBOOK_CREDENTIALS_KEY;
  if (!raw) return null;
  // Derive a 32-byte key from the user-provided secret
  return scryptSync(raw, "cobook-credentials", 32);
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: enc:v1:<iv>:<tag>:<ciphertext> (all base64)
  return (
    ENCRYPTED_PREFIX +
    iv.toString("base64") +
    ":" +
    tag.toString("base64") +
    ":" +
    encrypted.toString("base64")
  );
}

function decrypt(encoded: string, key: Buffer): string {
  if (!encoded.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error("Not an encrypted value");
  }
  const parts = encoded.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted value");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

function isEncrypted(content: string): boolean {
  return content.trimStart().startsWith(ENCRYPTED_PREFIX);
}

export async function loadCredentials(docsDir: string): Promise<void> {
  const credPath = join(docsDir, ".cobook", "credentials.yaml");
  try {
    let content = await readFile(credPath, "utf-8");

    // If the file is encrypted, decrypt it first
    if (isEncrypted(content)) {
      const key = getEncryptionKey();
      if (!key) {
        // Can't decrypt — credentials not available. Connector will report auth error.
        return;
      }
      content = decrypt(content.trim(), key);
    }

    const creds = parseYaml(content) as Record<string, Record<string, unknown>> | null;
    if (!creds || typeof creds !== "object") return;
    const store = getCredentialStore();
    for (const [name, auth] of Object.entries(creds)) {
      if (auth && typeof auth === "object") {
        store.set(name, auth);
      }
    }

    // Auto-encrypt plaintext file if encryption key is available
    if (!isEncrypted(await readFile(credPath, "utf-8"))) {
      const key = getEncryptionKey();
      if (key) {
        await encryptCredentialsFile(credPath, content, key);
      }
    }
  } catch {
    // File not found or parse error — silent. Connector will report "认证未配置" at runtime.
  }
}

async function encryptCredentialsFile(
  credPath: string,
  plaintext: string,
  key: Buffer,
): Promise<void> {
  try {
    const encrypted = encrypt(plaintext, key);
    await writeFile(credPath, encrypted + "\n", "utf-8");
  } catch {
    // Encryption failed — leave plaintext file as-is
  }
}

export async function saveCredentials(
  docsDir: string,
  yamlContent: string,
): Promise<void> {
  const credPath = join(docsDir, ".cobook", "credentials.yaml");
  await mkdir(dirname(credPath), { recursive: true });

  const key = getEncryptionKey();
  if (key) {
    await writeFile(credPath, encrypt(yamlContent, key) + "\n", "utf-8");
  } else {
    await writeFile(credPath, yamlContent, "utf-8");
  }
}
