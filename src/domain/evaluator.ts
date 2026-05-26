import { DateTime } from 'luxon';
import {
  EvaluationRequest,
  EvaluationResult,
  GlobalPolicy,
  UserChannelPreference,
  QuietHours,
  DefaultPreference,
  isMarketingNotification,
} from './types';

export interface EvaluatorDependencies {
  userPreferences: UserChannelPreference[];
  quietHours: QuietHours | null;
  globalPolicies: GlobalPolicy[];
  defaults: DefaultPreference[];
}

/**
 * Чистая функция оценки разрешения отправки уведомления.
 *
 * Не имеет побочных эффектов и не обращается к БД — все необходимые данные
 * передаются через deps. Это упрощает юнит-тестирование и позволяет
 * переиспользовать логику в разных контекстах (HTTP, batch, preview).
 *
 * Порядок приоритетов (от наивысшего к низшему):
 *   1. Глобальные политики платформы — перекрывают всё
 *   2. Явные настройки пользователя — переопределяют дефолты
 *   3. Quiet hours — блокируют только маркетинговые уведомления
 *   4. Дефолтные предпочтения — применяются при отсутствии явных настроек
 *
 * @param request - параметры уведомления: кому, что, по какому каналу, откуда, когда
 * @param deps    - снэпшот данных из БД, необходимых для принятия решения
 * @returns решение allow/deny и причина отказа (если deny)
 */
export function evaluate(
  request: EvaluationRequest,
  deps: EvaluatorDependencies,
): EvaluationResult {
  const { userId, notificationType, channel, region, datetime } = request;
  const { userPreferences, quietHours, globalPolicies, defaults } = deps;

  // 1. Глобальные политики
  const blockingPolicy = globalPolicies.find(
    (p) =>
      p.notificationType === notificationType &&
      p.region === region &&
      (p.channel === null || p.channel === channel),
  );
  if (blockingPolicy) {
    return { decision: 'deny', reason: 'blocked_by_global_policy' };
  }

  // 2. Явные настройки пользователя
  const userPref = userPreferences.find(
    (p) => p.userId === userId && p.notificationType === notificationType && p.channel === channel,
  );
  if (userPref !== undefined) {
    if (!userPref.enabled) {
      return { decision: 'deny', reason: 'disabled_by_user' };
    }
    // Пользователь явно включил канал — дополнительно проверяем quiet hours
    return checkQuietHours(isMarketingNotification(notificationType), quietHours, datetime);
  }

  // 3. Дефолтные предпочтения (пользователь не менял настройку)
  const defaultPref = defaults.find(
    (d) => d.notificationType === notificationType && d.channel === channel,
  );
  if (defaultPref !== undefined && !defaultPref.enabled) {
    return { decision: 'deny', reason: 'disabled_by_user' };
  }

  // 4. Quiet hours — последний барьер перед allow
  return checkQuietHours(isMarketingNotification(notificationType), quietHours, datetime);
}

/**
 * Проверяет, нужно ли блокировать уведомление из-за quiet hours.
 * Транзакционные уведомления (isMarketing = false) не блокируются никогда.
 *
 * @param isMarketing - признак маркетингового уведомления
 * @param quietHours  - настройки тихого периода или null, если не заданы
 * @param datetime    - момент отправки (UTC)
 */
function checkQuietHours(
  isMarketing: boolean,
  quietHours: QuietHours | null,
  datetime: Date,
): EvaluationResult {
  if (!isMarketing || quietHours === null) {
    return { decision: 'allow', reason: 'allowed' };
  }

  if (isDuringQuietHours(quietHours, datetime)) {
    return { decision: 'deny', reason: 'quiet_hours' };
  }

  return { decision: 'allow', reason: 'allowed' };
}

/**
 * Определяет, попадает ли момент времени datetime в тихий период пользователя.
 *
 * datetime переводится из UTC в таймзону пользователя, затем сравнивается
 * с границами startTime/endTime. Поддерживаются диапазоны, пересекающие
 * полночь (например, 22:00–08:00): startMinutes > endMinutes означает
 * ночной диапазон, и проверка инвертируется.
 *
 * @param quietHours - настройки тихого периода с таймзоной
 * @param datetime   - момент отправки уведомления (UTC)
 * @returns true, если datetime попадает в тихий период
 */
export function isDuringQuietHours(quietHours: QuietHours, datetime: Date): boolean {
  const userTime = DateTime.fromJSDate(datetime, { zone: quietHours.timezone });

  const [startH, startM] = quietHours.startTime.split(':').map(Number);
  const [endH, endM] = quietHours.endTime.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const currentMinutes = userTime.hour * 60 + userTime.minute;

  // Ночной диапазон (например 22:00–08:00) пересекает полночь
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // Дневной диапазон (например 13:00–15:00)
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}
