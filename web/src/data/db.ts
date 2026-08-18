import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PlayerProfile, StoredRound } from './model';

/**
 * Local persistence. Everything lives in IndexedDB so the app works with no
 * network at all — which is the normal condition on a golf course, not an edge
 * case.
 *
 * Writes are whole-document puts. A round is a few kilobytes and edits happen
 * at human speed, so there is no reason for anything cleverer.
 */

interface BirdieDB extends DBSchema {
  rounds: {
    key: string;
    value: StoredRound;
    indexes: { 'by-createdAt': number };
  };
  profiles: {
    key: string;
    value: PlayerProfile;
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'birdie';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<BirdieDB>> | null = null;

function db(): Promise<IDBPDatabase<BirdieDB>> {
  dbPromise ??= openDB<BirdieDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const rounds = database.createObjectStore('rounds', { keyPath: 'id' });
      rounds.createIndex('by-createdAt', 'createdAt');
      database.createObjectStore('profiles', { keyPath: 'id' });
      database.createObjectStore('settings');
    },
  });
  return dbPromise;
}

// MARK: Rounds

export async function allRounds(): Promise<StoredRound[]> {
  const rounds = await (await db()).getAllFromIndex('rounds', 'by-createdAt');
  return rounds.reverse(); // newest first
}

export async function loadRound(id: string): Promise<StoredRound | undefined> {
  return (await db()).get('rounds', id);
}

export async function saveRound(round: StoredRound): Promise<void> {
  await (await db()).put('rounds', { ...round, updatedAt: Date.now() });
}

export async function deleteRound(id: string): Promise<void> {
  await (await db()).delete('rounds', id);
}

/** The round still in progress, if any — what the app opens straight into. */
export async function activeRound(): Promise<StoredRound | undefined> {
  const rounds = await allRounds();
  return rounds.find((r) => r.status === 'live' || r.status === 'setup');
}

// MARK: Profiles

export async function allProfiles(): Promise<PlayerProfile[]> {
  const profiles = await (await db()).getAll('profiles');
  return profiles.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
}

export async function saveProfile(profile: PlayerProfile): Promise<void> {
  await (await db()).put('profiles', profile);
}

export async function deleteProfile(id: string): Promise<void> {
  await (await db()).delete('profiles', id);
}

export async function myProfile(): Promise<PlayerProfile | undefined> {
  return (await allProfiles()).find((p) => p.isMe);
}

// MARK: Settings

export async function readSetting<T>(key: string): Promise<T | undefined> {
  return (await db()).get('settings', key) as Promise<T | undefined>;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', value, key);
}
