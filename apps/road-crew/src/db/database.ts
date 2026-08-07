import * as SQLite from "expo-sqlite";

/**
 * Offline-first SQLite storage. Holds the full chat history per van plus the
 * outbound message queue (the "outbox"), so the driver app works end-to-end
 * with no connectivity and reconciles when the network returns.
 */

const DB_NAME = "road-crew.db";
const SCHEMA_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version;");
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS messages (
      clientMessageId TEXT PRIMARY KEY NOT NULL,
      id              TEXT,
      conversationId  TEXT NOT NULL,
      vanId           TEXT NOT NULL,
      senderType      TEXT NOT NULL,
      senderId        TEXT NOT NULL,
      body            TEXT NOT NULL,
      scope           TEXT NOT NULL DEFAULT 'van',
      status          TEXT NOT NULL,
      createdAtClient TEXT NOT NULL,
      createdAtServer TEXT,
      serverSeq       INTEGER,
      error           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_van_seq ON messages (vanId, serverSeq);
    CREATE INDEX IF NOT EXISTS idx_messages_status ON messages (status);

    CREATE TABLE IF NOT EXISTS conversation_meta (
      vanId         TEXT PRIMARY KEY NOT NULL,
      lastServerSeq INTEGER NOT NULL DEFAULT 0,
      readSeq       INTEGER NOT NULL DEFAULT 0,
      updatedAt     TEXT
    );
  `);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/** Opens (once) and migrates the database. Safe to call repeatedly. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
}

/** Test/teardown helper. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.closeAsync();
  dbPromise = null;
}
