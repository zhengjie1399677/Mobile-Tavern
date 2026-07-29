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
  downloadCount: number;
  downloadUrl: string;
}

interface DownloadTicket {
  downloadUrl: string;
}

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
}): Promise<CommunityCardSummary> {
  const body = new FormData();
  body.set("title", input.title);
  body.set("description", input.description);
  body.set("uploaderName", input.identity.name);
  body.set("uploaderUuid", input.identity.uuid);
  body.set("card", input.blob, input.fileName);

  const response = await fetch(buildCommunityUrl("/api/cards"), {
    method: "POST",
    body,
  });
  return readJson<CommunityCardSummary>(response);
}

export async function fetchCommunityCardFile(
  card: CommunityCardSummary,
  identity: CommunityIdentity,
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
  const blob = await fileResponse.blob();
  const extension = card.mimeType === "image/png" ? "png" : "json";
  return new File([blob], `${card.title}.${extension}`, { type: card.mimeType });
}
