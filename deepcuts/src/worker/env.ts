export interface Env {
  DB: D1Database;
  MUSIC: R2Bucket;
  ASSETS: Fetcher;
  OWNER_KEY: string;
  APP_ORIGIN: string;
  DEPLOY_REVISION: string;
  LOGIN_LIMIT: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}
export type AppEnv = { Bindings: Env };
