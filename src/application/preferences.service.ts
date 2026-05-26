import {
  UserPreferences,
  UserChannelPreference,
  QuietHours,
  UpdatePreferencesCommand,
} from '../domain/types';
import { DEFAULT_PREFERENCES } from '../domain/defaults';
import { IPreferencesRepository } from '../infrastructure/repositories/preferences.repository';
import { logger } from '../infrastructure/logger';

export class PreferencesService {
  constructor(private readonly repo: IPreferencesRepository) {}

  /**
   * Возвращает полные предпочтения пользователя.
   *
   * Мержит явные настройки из БД с дефолтами: если для пары тип+канал
   * нет записи в БД, используется значение из DEFAULT_PREFERENCES.
   * Таким образом, новые пользователи получают корректный набор предпочтений
   * без необходимости инициализировать БД при регистрации.
   *
   * @param userId - идентификатор пользователя
   * @returns агрегат из всех канальных настроек и quiet hours
   */
  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const [storedPrefs, quietHours] = await Promise.all([
      this.repo.findByUserId(userId),
      this.repo.findQuietHours(userId),
    ]);

    const storedMap = new Map(
      storedPrefs.map((p) => [`${p.notificationType}:${p.channel}`, p]),
    );

    const merged: UserChannelPreference[] = DEFAULT_PREFERENCES.map((def) => {
      const key = `${def.notificationType}:${def.channel}`;
      return (
        storedMap.get(key) ?? {
          userId,
          notificationType: def.notificationType,
          channel: def.channel,
          enabled: def.enabled,
          updatedAt: new Date(0), // epoch сигнализирует: это дефолт, не явная настройка
        }
      );
    });

    return { userId, channels: merged, quietHours };
  }

  /**
   * Применяет команду изменения предпочтений пользователя.
   *
   * Операция идемпотентна: повторный вызов с теми же данными не изменяет
   * состояние, поскольку запись в БД выполняется через INSERT ... ON CONFLICT DO UPDATE.
   * Поля команды независимы: можно обновить только каналы, только quiet hours или всё сразу.
   *
   * @param cmd - команда с userId и опциональными полями channelUpdates и quietHours
   * @returns актуальные предпочтения после применения изменений
   */
  async updatePreferences(cmd: UpdatePreferencesCommand): Promise<UserPreferences> {
    const { userId, channelUpdates, quietHours } = cmd;

    if (channelUpdates?.length) {
      for (const update of channelUpdates) {
        await this.repo.upsert({
          userId,
          notificationType: update.notificationType,
          channel: update.channel,
          enabled: update.enabled,
        });

        logger.info('preference_updated', {
          userId,
          notificationType: update.notificationType,
          channel: update.channel,
          enabled: update.enabled,
        });
      }
    }

    if (quietHours !== undefined) {
      if (quietHours === null) {
        await this.repo.deleteQuietHours(userId);
        logger.info('quiet_hours_removed', { userId });
      } else {
        await this.repo.upsertQuietHours({ userId, ...quietHours });
        logger.info('quiet_hours_updated', { userId, ...quietHours });
      }
    }

    return this.getUserPreferences(userId);
  }

  /**
   * Возвращает только явно сохранённые настройки пользователя без дефолтов.
   * Используется в EvaluationService, где дефолты передаются отдельно.
   *
   * @param userId - идентификатор пользователя
   */
  async getStoredPreferences(userId: string): Promise<UserChannelPreference[]> {
    return this.repo.findByUserId(userId);
  }

  /**
   * Возвращает настройки quiet hours пользователя или null, если не заданы.
   *
   * @param userId - идентификатор пользователя
   */
  async getQuietHours(userId: string): Promise<QuietHours | null> {
    return this.repo.findQuietHours(userId);
  }
}
