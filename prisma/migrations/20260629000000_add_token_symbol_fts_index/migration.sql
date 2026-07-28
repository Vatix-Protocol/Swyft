CREATE INDEX IF NOT EXISTS token_symbol_fts_idx
  ON "token" USING gin (to_tsvector('simple', "symbol"));
