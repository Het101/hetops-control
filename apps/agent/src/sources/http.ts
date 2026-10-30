// One HTTP call for the HTTP sources: a timeout, and errors that name the path and status but never echo a body or a header.
export async function http(url: string, init: RequestInit = {}): Promise<string> {
  const path = new URL(url).pathname;
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${res.status}`);
  return text;
}

export const json = async (url: string, init?: RequestInit): Promise<any> => JSON.parse(await http(url, init));
