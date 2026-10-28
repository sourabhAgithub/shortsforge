export type Clip = {
  clip_id: string;
  url: string | null;
  title: string;
  duration: number;
  width: number;
  height: number;
  has_audio: boolean;
  thumb: string;
  video: string;
};

export type Job<T = unknown> = {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  step: string;
  result: T | null;
  error: string | null;
};

export type Video = {
  id: string;
  tool: string;
  title: string;
  created_at: number;
  duration: number;
  video: string;
  thumb: string;
  download: string;
  project_id?: string;
};

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json" } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new Error("Can't reach ShortsForge. Is the start window still open?");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

/** Poll a background job until it finishes; resolves with its result or throws its error. */
export async function waitForJob<T>(job: Job<T>, onUpdate: (j: Job<T>) => void): Promise<T> {
  let current = job;
  for (;;) {
    onUpdate(current);
    if (current.status === "done") return current.result as T;
    if (current.status === "error") throw new Error(current.error ?? "Something went wrong.");
    await new Promise((r) => setTimeout(r, 600));
    current = await api<Job<T>>(`/api/jobs/${current.id}`);
  }
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m ? `${m}:${String(sec).padStart(2, "0")}` : `${s.toFixed(1)}s`;
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
