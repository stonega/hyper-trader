import type { Database, SQLQueryBindings } from "bun:sqlite";

import type { ExpoSqliteSyncConnection } from "./action-journal";

export function bunSqliteConnection(
  database: Database,
): ExpoSqliteSyncConnection {
  return {
    execSync(sql) {
      database.exec(sql);
    },
    runSync(sql, parameters = []) {
      const result = database
        .query(sql)
        .run(...(parameters as readonly SQLQueryBindings[]));
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getFirstSync<T>(sql: string, parameters = []): T | null {
      return (
        (database
          .query(sql)
          .get(...(parameters as readonly SQLQueryBindings[])) as T | null) ??
        null
      );
    },
    getAllSync<T>(sql: string, parameters = []): T[] {
      return database
        .query(sql)
        .all(...(parameters as readonly SQLQueryBindings[])) as T[];
    },
  };
}
