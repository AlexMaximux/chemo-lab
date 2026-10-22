import { entriesToCSV, entriesToJSON } from './export';

export const NOTEBOOK_STORAGE_KEY = 'chemlab_notebook_v1';

export interface Entry {
  id?: string;
  timestamp: number;
  simTime?: number;
  action: string;
  vesselId?: string;
  details: string;
  reaction?: string;
  tempK?: number;
  pH?: number;
  pressureKPa?: number;
  hazards?: string[];
}

const fallbackStore = new Map<string, string>();

const memoryStorage: Storage = {
  get length(): number {
    return fallbackStore.size;
  },
  clear(): void {
    fallbackStore.clear();
  },
  getItem(key: string): string | null {
    return fallbackStore.has(key) ? fallbackStore.get(key)! : null;
  },
  key(index: number): string | null {
    return Array.from(fallbackStore.keys())[index] ?? null;
  },
  removeItem(key: string): void {
    fallbackStore.delete(key);
  },
  setItem(key: string, value: string): void {
    fallbackStore.set(key, String(value));
  },
};

function getSafeStorage(): Storage {
  if (typeof window !== 'undefined') {
    try {
      const ls = window.localStorage;
      if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
        ls.getItem(NOTEBOOK_STORAGE_KEY);
        return ls;
      }
    } catch {
      // Fallback to in-memory storage if blocked
    }
  }

  try {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    if (!desc || desc.get) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: memoryStorage,
        configurable: true,
        writable: true,
      });
    } else if (desc.value && typeof desc.value.getItem === 'function') {
      return desc.value as Storage;
    }
  } catch {
    // Ignore if globalThis.localStorage is non-configurable
  }

  return memoryStorage;
}

// Ensure globalThis.localStorage is usable immediately on module load
getSafeStorage();

export class Notebook {
  private logEntries: Entry[] = [];

  constructor(initialEntries?: Entry[]) {
    if (Array.isArray(initialEntries)) {
      this.logEntries = initialEntries.map((e) => ({ ...e }));
    }
  }

  public log(entry: Entry): void {
    const normalized: Entry = {
      id: entry.id ?? `nb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
      simTime: entry.simTime,
      action: String(entry.action || 'info'),
      vesselId: entry.vesselId,
      details: String(entry.details || ''),
      reaction: entry.reaction,
      tempK: entry.tempK,
      pH: entry.pH,
      pressureKPa: entry.pressureKPa,
      hazards: entry.hazards ? [...entry.hazards] : undefined,
    };
    this.logEntries.push(normalized);
  }

  public entries(): Entry[] {
    return this.logEntries.map((e) => ({ ...e }));
  }

  public clear(): void {
    this.logEntries = [];
  }

  public toJSON(): string {
    return entriesToJSON(this.logEntries);
  }

  public toCSV(): string {
    return entriesToCSV(this.logEntries);
  }

  public save(): void {
    const storage = getSafeStorage();
    try {
      storage.setItem(NOTEBOOK_STORAGE_KEY, this.toJSON());
    } catch {
      // Ignore quota exceeded errors
    }
  }

  public static load(): Notebook {
    const storage = getSafeStorage();
    try {
      const raw = storage.getItem(NOTEBOOK_STORAGE_KEY);
      if (!raw) {
        return new Notebook();
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return new Notebook();
      }
      const validEntries: Entry[] = [];
      for (const item of parsed) {
        if (
          item &&
          typeof item === 'object' &&
          typeof item.action === 'string' &&
          typeof item.details === 'string' &&
          typeof item.timestamp === 'number'
        ) {
          validEntries.push({
            id: typeof item.id === 'string' ? item.id : undefined,
            timestamp: item.timestamp,
            simTime: typeof item.simTime === 'number' ? item.simTime : undefined,
            action: item.action,
            vesselId: typeof item.vesselId === 'string' ? item.vesselId : undefined,
            details: item.details,
            reaction: typeof item.reaction === 'string' ? item.reaction : undefined,
            tempK: typeof item.tempK === 'number' ? item.tempK : undefined,
            pH: typeof item.pH === 'number' ? item.pH : undefined,
            pressureKPa: typeof item.pressureKPa === 'number' ? item.pressureKPa : undefined,
            hazards: Array.isArray(item.hazards) ? item.hazards : undefined,
          });
        }
      }
      return new Notebook(validEntries);
    } catch {
      return new Notebook();
    }
  }

  public static setRawStorage(key: string, value: string): void {
    const storage = getSafeStorage();
    storage.setItem(key, value);
  }
}
