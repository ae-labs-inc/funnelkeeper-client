// Bearer fetch wrapper shared by the CLI and the MCP server.
export type ClientKind = "cli" | "mcp";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function makeClient(opts: { apiUrl: string; apiKey: string; client: ClientKind; version: string }) {
  const base = opts.apiUrl.replace(/\/$/, "");
  async function req<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      // content-type only when a body ships: Fastify 4 rejects an empty body
      // that claims to be JSON.
      const headers: Record<string, string> = {
        authorization: `Bearer ${opts.apiKey}`,
        "x-fk-client": `${opts.client}/${opts.version}`,
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(`can't reach the api at ${base}`, 0);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg = (parsed as { error?: string })?.error ?? `${res.status} ${res.statusText}`;
      throw new ApiError(msg, res.status);
    }
    return (parsed ?? text) as T;
  }
  return {
    get: <T>(path: string) => req<T>("GET", path),
    post: <T>(path: string, body?: unknown) => req<T>("POST", path, body),
    delete: <T>(path: string) => req<T>("DELETE", path),
    base,
  };
}
