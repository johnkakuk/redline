-- Only session-volume PRs are tracked now; drop the other record types.
DELETE FROM personal_records WHERE type != 'session_volume';
