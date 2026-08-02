import { buildCommunityUrl } from "./config";
import type { CommunityIdentity } from "./identity";

export interface CommunityCardSummary {
  id: string;
  title: string;
  description: string;
  mimeType: string;
  fileSize: number;
  uploaderName: string;
  createdAt: number;
  lastDownloadedAt?: number | null;
  downloadCount: number;
  downloadUrl: string;
  /** PNG 角色卡的封面缩略图地址（相对路径）；JSON 卡或缩略图生成失败时为 null。 */
  thumbnailUrl?: string | null;
}

export interface CommunityComment {
  id: string;
  cardId: string;
  authorName: string;
  content: string;
  createdAt: number;
}

interface DownloadTicket {
  downloadUrl: string;
}

export type CommunityProgressCallback = (progress: number) => void;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch((): null => null);
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listCommunityCards(
  search = "",
  signal?: AbortSignal,
): Promise<CommunityCardSummary[]> {
  const query = new URLSearchParams({ limit: "30" });
  if (search.trim()) query.set("q", search.trim());
  const response = await fetch(buildCommunityUrl(`/api/cards?${query}`), { signal });
  return readJson<CommunityCardSummary[]>(response);
}

export async function uploadCommunityCard(input: {
  blob: Blob;
  fileName: string;
  title: string;
  description: string;
  identity: CommunityIdentity;
  onProgress?: CommunityProgressCallback;
}): Promise<CommunityCardSummary> {
  const body = new FormData();
  body.set("title", input.title);
  body.set("description", input.description);
  body.set("uploaderName", input.identity.name);
  body.set("uploaderUuid", input.identity.uuid);
  body.set("card", input.blob, input.fileName);

  return new Promise<CommunityCardSummary>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", buildCommunityUrl("/api/cards"));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new Error("NETWORK_ERROR"));
    request.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error(`HTTP ${request.status}`));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `HTTP ${request.status}`;
        reject(new Error(message));
        return;
      }
      input.onProgress?.(100);
      resolve(payload as CommunityCardSummary);
    };
    request.send(body);
  });
}

export async function fetchCommunityCardFile(
  card: CommunityCardSummary,
  identity: CommunityIdentity,
  onProgress?: CommunityProgressCallback,
): Promise<File> {
  const ticketResponse = await fetch(
    buildCommunityUrl(`/api/cards/${encodeURIComponent(card.id)}/download`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorName: identity.name,
        actorUuid: identity.uuid,
      }),
    },
  );
  const ticket = await readJson<DownloadTicket>(ticketResponse);
  const fileResponse = await fetch(buildCommunityUrl(ticket.downloadUrl));
  if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status}`);
  const total = Number(fileResponse.headers.get("Content-Length") || card.fileSize);
  let blob: Blob;
  if (fileResponse.body && total > 0) {
    const reader = fileResponse.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(Math.min(100, Math.round((loaded / total) * 100)));
    }
    blob = new Blob(chunks as BlobPart[], { type: card.mimeType });
  } else {
    blob = await fileResponse.blob();
  }
  onProgress?.(100);
  const extension = card.mimeType === "image/png" ? "png" : "json";
  return new File([blob], `${card.title}.${extension}`, { type: card.mimeType });
}

export async function listCommunityComments(
  cardId: string,
  signal?: AbortSignal,
): Promise<CommunityComment[]> {
  const response = await fetch(
    buildCommunityUrl(`/api/cards/${encodeURIComponent(cardId)}/comments?limit=30`),
    { signal },
  );
  return readJson<CommunityComment[]>(response);
}

export async function createCommunityComment(input: {
  cardId: string;
  identity: CommunityIdentity;
  content: string;
}): Promise<CommunityComment> {
  const response = await fetch(
    buildCommunityUrl(`/api/cards/${encodeURIComponent(input.cardId)}/comments`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorName: input.identity.name,
        authorUuid: input.identity.uuid,
        content: input.content,
      }),
    },
  );
  return readJson<CommunityComment>(response);
}

export async function verifyCommunityAdmin(token: string): Promise<void> {
  const response = await fetch(buildCommunityUrl("/api/admin/verify"), {
    method: "POST",
    headers: { "X-Admin-Token": token },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function deleteCommunityCard(
  cardId: string,
  adminToken: string,
): Promise<void> {
  const response = await fetch(
    buildCommunityUrl(`/api/cards/${encodeURIComponent(cardId)}`),
    { method: "DELETE", headers: { "X-Admin-Token": adminToken } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function deleteCommunityComment(
  commentId: string,
  adminToken: string,
): Promise<void> {
  const response = await fetch(
    buildCommunityUrl(`/api/comments/${encodeURIComponent(commentId)}`),
    { method: "DELETE", headers: { "X-Admin-Token": adminToken } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
