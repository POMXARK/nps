import { Pool, PoolClient } from 'pg';
import { GlobalPolicy, NotificationType, Channel, Region } from '../../domain/types';

export interface IPoliciesRepository {
  /** Возвращает все политики, применимые к данному типу уведомления и региону. */
  findApplicable(notificationType: NotificationType, region: Region): Promise<GlobalPolicy[]>;
  /** Возвращает полный список всех активных глобальных политик. */
  findAll(): Promise<GlobalPolicy[]>;
  /** Создаёт новую политику. Повторный вызов с тем же id игнорируется (ON CONFLICT DO NOTHING). */
  create(policy: Omit<GlobalPolicy, 'createdAt'>): Promise<GlobalPolicy>;
  /** Удаляет политику по идентификатору. Не бросает ошибку, если запись не найдена. */
  deleteById(id: string): Promise<void>;
}

export class PoliciesRepository implements IPoliciesRepository {
  constructor(private readonly db: Pool | PoolClient) {}

  /**
   * Загружает политики, которые могут заблокировать конкретное уведомление.
   * Фильтрует по типу уведомления и региону — канал сравнивается в evaluator,
   * чтобы не усложнять SQL (политика с channel = null применяется ко всем каналам).
   *
   * @param notificationType - тип уведомления для проверки
   * @param region           - регион получателя
   */
  async findApplicable(notificationType: NotificationType, region: Region): Promise<GlobalPolicy[]> {
    const result = await this.db.query<{
      id: string;
      notification_type: string;
      channel: string | null;
      region: string;
      decision: string;
      reason: string;
      created_at: Date;
    }>(
      `SELECT id, notification_type, channel, region, decision, reason, created_at
       FROM global_policies
       WHERE notification_type = $1 AND region = $2`,
      [notificationType, region],
    );

    return result.rows.map(rowToPolicy);
  }

  /**
   * Загружает все активные политики платформы.
   * Используется в административном API (GET /policies).
   */
  async findAll(): Promise<GlobalPolicy[]> {
    const result = await this.db.query<{
      id: string;
      notification_type: string;
      channel: string | null;
      region: string;
      decision: string;
      reason: string;
      created_at: Date;
    }>('SELECT id, notification_type, channel, region, decision, reason, created_at FROM global_policies ORDER BY created_at');

    return result.rows.map(rowToPolicy);
  }

  /**
   * Сохраняет новую глобальную политику.
   * Повторный вызов с тем же id пропускается (ON CONFLICT DO NOTHING),
   * что делает создание идемпотентным при наличии заранее известного id.
   *
   * @param policy - данные политики без поля createdAt (проставляется БД через NOW())
   */
  async create(policy: Omit<GlobalPolicy, 'createdAt'>): Promise<GlobalPolicy> {
    const result = await this.db.query<{
      id: string;
      notification_type: string;
      channel: string | null;
      region: string;
      decision: string;
      reason: string;
      created_at: Date;
    }>(
      `INSERT INTO global_policies (id, notification_type, channel, region, decision, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [policy.id, policy.notificationType, policy.channel, policy.region, policy.decision, policy.reason],
    );

    return rowToPolicy(result.rows[0]);
  }

  /**
   * Удаляет политику по идентификатору.
   * Используется, когда правило нужно отменить (например, отзыв регуляторного запрета).
   * Не выбрасывает ошибку, если запись отсутствует.
   *
   * @param id - UUID политики
   */
  async deleteById(id: string): Promise<void> {
    await this.db.query('DELETE FROM global_policies WHERE id = $1', [id]);
  }
}

/**
 * Преобразует строку результата SQL-запроса в доменный объект GlobalPolicy.
 * Применяется ко всем методам, читающим из таблицы global_policies.
 */
function rowToPolicy(row: {
  id: string;
  notification_type: string;
  channel: string | null;
  region: string;
  decision: string;
  reason: string;
  created_at: Date;
}): GlobalPolicy {
  return {
    id: row.id,
    notificationType: row.notification_type as NotificationType,
    channel: (row.channel ?? null) as Channel | null,
    region: row.region as Region,
    decision: row.decision as 'deny',
    reason: row.reason,
    createdAt: row.created_at,
  };
}
