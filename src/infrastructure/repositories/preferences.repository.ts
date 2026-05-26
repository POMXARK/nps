import { Pool, PoolClient } from 'pg';
import {
  UserChannelPreference,
  QuietHours,
  NotificationType,
  Channel,
} from '../../domain/types';

export interface IPreferencesRepository {
  /** Возвращает все явные настройки пользователя по всем парам тип+канал. */
  findByUserId(userId: string): Promise<UserChannelPreference[]>;
  /** Возвращает настройку по конкретной паре тип+канал или null, если не задана. */
  findOne(userId: string, notificationType: NotificationType, channel: Channel): Promise<UserChannelPreference | null>;
  /** Создаёт или обновляет настройку для пары тип+канал (upsert по PK). */
  upsert(pref: Omit<UserChannelPreference, 'updatedAt'>): Promise<UserChannelPreference>;
  /** Возвращает настройки quiet hours пользователя или null, если не заданы. */
  findQuietHours(userId: string): Promise<QuietHours | null>;
  /** Создаёт или полностью заменяет настройки quiet hours (upsert по user_id). */
  upsertQuietHours(qh: Omit<QuietHours, 'updatedAt'>): Promise<QuietHours>;
  /** Удаляет настройки quiet hours пользователя. Не бросает ошибку, если записи нет. */
  deleteQuietHours(userId: string): Promise<void>;
}

export class PreferencesRepository implements IPreferencesRepository {
  constructor(private readonly db: Pool | PoolClient) {}

  /**
   * Загружает все явные настройки пользователя из БД.
   * Не включает дефолты — их мерджит PreferencesService.
   *
   * @param userId - идентификатор пользователя
   */
  async findByUserId(userId: string): Promise<UserChannelPreference[]> {
    const result = await this.db.query<{
      user_id: string;
      notification_type: string;
      channel: string;
      enabled: boolean;
      updated_at: Date;
    }>(
      `SELECT user_id, notification_type, channel, enabled, updated_at
       FROM user_channel_preferences
       WHERE user_id = $1
       ORDER BY notification_type, channel`,
      [userId],
    );

    return result.rows.map(rowToPreference);
  }

  /**
   * Загружает одну настройку по точному ключу (userId, notificationType, channel).
   * Возвращает null, если пользователь не менял эту настройку.
   *
   * @param userId           - идентификатор пользователя
   * @param notificationType - тип уведомления
   * @param channel          - канал доставки
   */
  async findOne(
    userId: string,
    notificationType: NotificationType,
    channel: Channel,
  ): Promise<UserChannelPreference | null> {
    const result = await this.db.query<{
      user_id: string;
      notification_type: string;
      channel: string;
      enabled: boolean;
      updated_at: Date;
    }>(
      `SELECT user_id, notification_type, channel, enabled, updated_at
       FROM user_channel_preferences
       WHERE user_id = $1 AND notification_type = $2 AND channel = $3`,
      [userId, notificationType, channel],
    );

    return result.rows[0] ? rowToPreference(result.rows[0]) : null;
  }

  /**
   * Сохраняет настройку пользователя через upsert по первичному ключу.
   * Если запись существует — обновляет поле enabled и updated_at.
   * Идемпотентен: повторный вызов с теми же данными не создаёт дублей.
   *
   * @param pref - настройка без поля updatedAt (проставляется БД через NOW())
   */
  async upsert(pref: Omit<UserChannelPreference, 'updatedAt'>): Promise<UserChannelPreference> {
    const result = await this.db.query<{
      user_id: string;
      notification_type: string;
      channel: string;
      enabled: boolean;
      updated_at: Date;
    }>(
      `INSERT INTO user_channel_preferences (user_id, notification_type, channel, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, notification_type, channel)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
       RETURNING *`,
      [pref.userId, pref.notificationType, pref.channel, pref.enabled],
    );

    return rowToPreference(result.rows[0]);
  }

  /**
   * Загружает настройки quiet hours пользователя.
   * Возвращает null, если пользователь не задавал тихие часы.
   *
   * @param userId - идентификатор пользователя
   */
  async findQuietHours(userId: string): Promise<QuietHours | null> {
    const result = await this.db.query<{
      user_id: string;
      start_time: string;
      end_time: string;
      timezone: string;
      updated_at: Date;
    }>(
      `SELECT user_id, start_time, end_time, timezone, updated_at
       FROM user_quiet_hours
       WHERE user_id = $1`,
      [userId],
    );

    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      userId: row.user_id,
      startTime: row.start_time,
      endTime: row.end_time,
      timezone: row.timezone,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Создаёт или полностью заменяет настройки quiet hours через upsert по user_id.
   * Все три поля (startTime, endTime, timezone) всегда перезаписываются целиком.
   *
   * @param qh - настройки без поля updatedAt (проставляется БД через NOW())
   */
  async upsertQuietHours(qh: Omit<QuietHours, 'updatedAt'>): Promise<QuietHours> {
    const result = await this.db.query<{
      user_id: string;
      start_time: string;
      end_time: string;
      timezone: string;
      updated_at: Date;
    }>(
      `INSERT INTO user_quiet_hours (user_id, start_time, end_time, timezone, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET start_time = EXCLUDED.start_time,
                     end_time   = EXCLUDED.end_time,
                     timezone   = EXCLUDED.timezone,
                     updated_at = NOW()
       RETURNING *`,
      [qh.userId, qh.startTime, qh.endTime, qh.timezone],
    );

    const row = result.rows[0];
    return {
      userId: row.user_id,
      startTime: row.start_time,
      endTime: row.end_time,
      timezone: row.timezone,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Удаляет настройки quiet hours пользователя.
   * Не выбрасывает ошибку, если запись отсутствует — DELETE идемпотентен.
   *
   * @param userId - идентификатор пользователя
   */
  async deleteQuietHours(userId: string): Promise<void> {
    await this.db.query('DELETE FROM user_quiet_hours WHERE user_id = $1', [userId]);
  }
}

/**
 * Преобразует строку результата SQL-запроса в доменный объект UserChannelPreference.
 * Применяется ко всем методам, читающим из таблицы user_channel_preferences.
 */
function rowToPreference(row: {
  user_id: string;
  notification_type: string;
  channel: string;
  enabled: boolean;
  updated_at: Date;
}): UserChannelPreference {
  return {
    userId: row.user_id,
    notificationType: row.notification_type as NotificationType,
    channel: row.channel as Channel,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}
