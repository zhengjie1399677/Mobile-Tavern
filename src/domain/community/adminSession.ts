let adminToken: string | null = null;

export function setCommunityAdminToken(token: string): void {
  adminToken = token;
}

export function getCommunityAdminToken(): string | null {
  return adminToken;
}

export function clearCommunityAdminToken(): void {
  adminToken = null;
}

export function isCommunityAdmin(): boolean {
  return adminToken !== null;
}
