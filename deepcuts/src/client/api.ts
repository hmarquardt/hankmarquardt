export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: `Request failed (${response.status}).` }))) as {
      error: string;
    };
    throw new Error(body.error);
  }
  return response.json() as Promise<T>;
}
export const jsonOptions = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
