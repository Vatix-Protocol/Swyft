CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS token_symbol_gin_trgm_idx
  ON "token" USING gin ("symbol" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS token_name_gin_trgm_idx
  ON "token" USING gin ("name" gin_trgm_ops);
