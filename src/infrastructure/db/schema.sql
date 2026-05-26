-- Notification Preferences Service — схема БД
-- Запускается однократно через migrate.ts

CREATE TABLE IF NOT EXISTS user_channel_preferences (
    user_id            TEXT                NOT NULL,
    notification_type  TEXT                NOT NULL,
    channel            TEXT                NOT NULL,
    enabled            BOOLEAN             NOT NULL,
    updated_at         TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, notification_type, channel)
);

CREATE TABLE IF NOT EXISTS user_quiet_hours (
    user_id    TEXT        NOT NULL PRIMARY KEY,
    start_time TEXT        NOT NULL, -- "HH:MM"
    end_time   TEXT        NOT NULL, -- "HH:MM"
    timezone   TEXT        NOT NULL, -- IANA tz
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_policies (
    id                TEXT        NOT NULL PRIMARY KEY,
    notification_type TEXT        NOT NULL,
    channel           TEXT,        -- NULL = все каналы этого типа
    region            TEXT        NOT NULL,
    decision          TEXT        NOT NULL DEFAULT 'deny',
    reason            TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_policies_type_region
    ON global_policies (notification_type, region);

CREATE INDEX IF NOT EXISTS idx_user_prefs_user_id
    ON user_channel_preferences (user_id);
