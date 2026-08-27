export interface MobileStorageAdapter {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface MobileLifecycleAdapter {
  onForeground?(callback: () => void): () => void;
  onBackground?(callback: () => void): () => void;
}

export interface MobileNetworkAdapter {
  onNetworkRestored?(callback: () => void): () => void;
}

export class InMemoryMobileStorageAdapter implements MobileStorageAdapter {
  private readonly store = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }
}
