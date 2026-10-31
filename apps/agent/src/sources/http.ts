// One HTTP call for the HTTP sources and actions: a timeout, and errors that name the path and status but never echo a body
// or a header. A caller's signal (an action's 55 s limit) ends the call too.
export async function http(url: string, init: RequestInit = {}): Promise<string> {
  const path = new URL(url).pathname;
  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${res.status}`);
  return text;
}

export const json = async (url: string, init?: RequestInit): Promise<any> => JSON.parse(await http(url, init));
