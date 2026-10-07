export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export class TabRegistry {
  extensionConnected = false;
  activeTab?: number;
  pageGeneration = new Map<number, number>();
  lastSeen = new Map<number, TabInfo>();

  setTabs(tabs: TabInfo[], activeTab?: number): void {
    this.lastSeen.clear();
    for (const t of tabs) this.lastSeen.set(t.id, t);
    if (activeTab !== undefined) this.activeTab = activeTab;
  }

  bumpGeneration(tabId: number): number {
    const g = (this.pageGeneration.get(tabId) ?? 0) + 1;
    this.pageGeneration.set(tabId, g);
    return g;
  }
}
