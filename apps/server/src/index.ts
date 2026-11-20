export { loadConfig } from './config';
export type { AppConfig } from './config';
export { DATA_DIR, MIGRATIONS_DIR, REPO_ROOT } from './paths';

export {
  createSqliteHandle,
  openDatabase,
  parseDatabaseUrl,
} from './db/client';
export type {
  DatabaseTarget,
  DbHandle,
  PgDb,
  PostgresHandle,
  SqliteDb,
  SqliteHandle,
} from './db/client';
export * as pgSchema from './db/schema/pg';
export * as sqliteSchema from './db/schema/sqlite';
export * from './db/schema/enums';

export { DATA_FILES, DatasetFileError, loadDataset } from './data/dataset';
export type { ClubRecord, CsvPlayerRecord, Dataset, PlayerRecord } from './data/dataset';
export { DATA_RULES, validateDataset } from './data/validate';
export type {
  ClubSummary,
  DataIssue,
  DataRules,
  IssueCode,
  ValidationResult,
} from './data/validate';
export { planChanges, seedDatabase, SeedValidationError } from './data/seed';
export type { ChangePlan, SeedCounts, SeedReport } from './data/seed';
