CREATE UNIQUE INDEX IF NOT EXISTS economy_ledger_channel_point_source_idx
  ON economy_ledger (source_type, source_id)
  WHERE source_type = 'channel_point_redemption' AND source_id IS NOT NULL;
