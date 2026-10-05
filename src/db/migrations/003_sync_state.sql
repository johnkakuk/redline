-- Local-only sync bookkeeping (device token, push watermark). Never exported or synced.
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
