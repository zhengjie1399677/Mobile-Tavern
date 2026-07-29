const COMMUNITY_IDENTITY_KEY = "mobile-tavern.community.identity.v1";

export interface CommunityIdentity {
  uuid: string;
  name: string;
}

function createUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function getCommunityIdentity(currentUserName: string): CommunityIdentity {
  const normalizedName = currentUserName.trim().slice(0, 64) || "user";
  let uuid = createUuid();

  try {
    const stored = JSON.parse(localStorage.getItem(COMMUNITY_IDENTITY_KEY) || "null");
    if (typeof stored?.uuid === "string" && stored.uuid.length >= 32) {
      uuid = stored.uuid;
    }
    const identity = { uuid, name: normalizedName };
    localStorage.setItem(COMMUNITY_IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  } catch {
    return { uuid, name: normalizedName };
  }
}
