// src/lib/download.ts
import { useAuthStore } from "@/store/auth";

export function getApiBase(): string {
  const st: any = (useAuthStore as any)?.getState?.();
  const fromStore = st?.apiBase;
  if (fromStore) return String(fromStore).replace(/\/+$/, "");

  const env = (import.meta as any)?.env?.VITE_API_URL as string | undefined;
  if (env) return env.replace(/\/+$/, "");

  const u = new URL(window.location.href);
  const devPorts = new Set(["5173", "5174", "5175", "5137"]);
  const port = devPorts.has(u.port) ? "8000" : u.port;
  return `${u.protocol}//${u.hostname}${port ? ":" + port : ""}`;
}

export function getAuthHeader(): string {
  const st: any = (useAuthStore as any)?.getState?.();
  const raw =
    st?.token ||
    st?.accessToken ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("access_token") ||
    "";
  if (!raw) return "";
  return raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(path.replace(/^\//, ""), getApiBase() + "/");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url;
}

export async function downloadWithAuth(
  path: string,
  params?: Record<string, string | number | undefined>,
  filename?: string
): Promise<void> {
  const url = buildUrl(path, params);
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/octet-stream",
      Authorization: getAuthHeader(),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t || res.statusText}`);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  const cd = res.headers.get("content-disposition") || "";
  const cdName = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(cd)?.[1] ?? undefined;
  a.href = URL.createObjectURL(blob);
  a.download = filename || decodeURIComponent(cdName || path.split("/").pop() || "download.xlsx");
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
