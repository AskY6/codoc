interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();

export async function getTenantToken(appId: string, appSecret: string): Promise<string> {
  const cacheKey = `${appId}:${appSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { code: number; msg: string; tenant_access_token: string; expire: number };
  if (data.code !== 0) {
    throw {
      kind: "source",
      message: `飞书认证失败: ${data.msg}`,
      retryable: data.code === 99991400,
    };
  }

  // Cache with some margin (expire - 5 min)
  const ttlMs = Math.max((data.expire - 300) * 1000, 0);
  tokenCache.set(cacheKey, {
    token: data.tenant_access_token,
    expiresAt: Date.now() + ttlMs,
  });

  return data.tenant_access_token;
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
