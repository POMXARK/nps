// Основные доменные перечисления — строгие литеральные типы вместо строк

export const NOTIFICATION_TYPES = [
  'transactional_email',
  'marketing_email',
  'transactional_sms',
  'marketing_sms',
  'transactional_push',
  'marketing_push',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CHANNELS = ['email', 'sms', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];

export const REGIONS = ['EU', 'US', 'APAC', 'LATAM', 'OTHER'] as const;
export type Region = (typeof REGIONS)[number];

/**
 * Определяет, является ли тип уведомления маркетинговым.
 * Маркетинговые уведомления блокируются в quiet hours и выключены по умолчанию.
 * Транзакционные — проходят в любое время суток, если не отключены явно.
 */
export function isMarketingNotification(type: NotificationType): boolean {
  return type.startsWith('marketing_');
}

/**
 * Возвращает канал доставки, соответствующий типу уведомления.
 * Инвариант домена: каждый тип однозначно привязан к одному каналу.
 */
export function getChannelForType(type: NotificationType): Channel {
  if (type.endsWith('_email')) return 'email';
  if (type.endsWith('_sms')) return 'sms';
  return 'push';
}

/** Явная настройка пользователя для конкретной пары тип+канал. */
export interface UserChannelPreference {
  userId: string;
  notificationType: NotificationType;
  channel: Channel;
  /** true — уведомление разрешено, false — заблокировано пользователем. */
  enabled: boolean;
  updatedAt: Date;
}

/**
 * Период тишины, в течение которого маркетинговые уведомления не доставляются.
 * startTime/endTime задаются в формате "HH:MM" (24ч) в таймзоне пользователя.
 * Поддерживаются диапазоны, пересекающие полночь (например, 22:00–08:00).
 */
export interface QuietHours {
  userId: string;
  /** Начало тихого периода, формат "HH:MM". */
  startTime: string;
  /** Конец тихого периода, формат "HH:MM". */
  endTime: string;
  /** IANA-таймзона пользователя, например "Europe/Moscow". */
  timezone: string;
  updatedAt: Date;
}

/**
 * Глобальная политика платформы, запрещающая определённый тип уведомлений в регионе.
 * Имеет наивысший приоритет: перекрывает любые пользовательские настройки.
 * Если channel равен null, политика применяется ко всем каналам данного типа.
 */
export interface GlobalPolicy {
  id: string;
  notificationType: NotificationType;
  /** null означает запрет по всем каналам указанного типа. */
  channel: Channel | null;
  region: Region;
  /** Сейчас поддерживается только 'deny'. */
  decision: 'deny';
  /** Человекочитаемое описание причины политики (например, "GDPR compliance"). */
  reason: string;
  createdAt: Date;
}

/** Дефолтное предпочтение, применяемое к новым пользователям без явных настроек. */
export interface DefaultPreference {
  notificationType: NotificationType;
  channel: Channel;
  enabled: boolean;
}

/** Входные данные для проверки возможности отправки уведомления. */
export interface EvaluationRequest {
  userId: string;
  notificationType: NotificationType;
  channel: Channel;
  region: Region;
  /** Момент отправки (UTC). Используется для проверки quiet hours. */
  datetime: Date;
}

export type DenyReason =
  | 'blocked_by_global_policy'
  | 'disabled_by_user'
  | 'quiet_hours'
  | 'channel_type_mismatch';

/** Результат проверки: решение и краткое объяснение. */
export interface EvaluationResult {
  decision: 'allow' | 'deny';
  reason: DenyReason | 'allowed' | null;
}

/** Полный агрегат предпочтений пользователя, возвращаемый через API. */
export interface UserPreferences {
  userId: string;
  /** Список настроек по каждому типу+каналу (включая дефолты). */
  channels: UserChannelPreference[];
  quietHours: QuietHours | null;
}

/**
 * Команда изменения предпочтений пользователя.
 * Оба поля опциональны — можно обновить только каналы, только quiet hours или всё сразу.
 * Передача quietHours: null удаляет настройку тихих часов.
 */
export interface UpdatePreferencesCommand {
  userId: string;
  channelUpdates?: Array<{
    notificationType: NotificationType;
    channel: Channel;
    enabled: boolean;
  }>;
  /** undefined — не трогать, null — удалить, объект — создать/обновить. */
  quietHours?: {
    startTime: string;
    endTime: string;
    timezone: string;
  } | null;
}
