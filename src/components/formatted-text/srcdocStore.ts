const srcdocStore = new Map<string, string>();

export function storeFormattedTextSrcdoc(key: string, srcdoc: string): void {
  srcdocStore.set(key, srcdoc);
}

export function readFormattedTextSrcdoc(key: string): string | undefined {
  return srcdocStore.get(key);
}
