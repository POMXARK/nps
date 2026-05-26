import { EvaluationRequest, EvaluationResult } from '../domain/types';
import { evaluate } from '../domain/evaluator';
import { DEFAULT_PREFERENCES } from '../domain/defaults';
import { IPreferencesRepository } from '../infrastructure/repositories/preferences.repository';
import { IPoliciesRepository } from '../infrastructure/repositories/policies.repository';
import { logger } from '../infrastructure/logger';

export class EvaluationService {
  constructor(
    private readonly preferencesRepo: IPreferencesRepository,
    private readonly policiesRepo: IPoliciesRepository,
  ) {}

  /**
   * Проверяет, можно ли отправить уведомление пользователю.
   *
   * Параллельно загружает из БД три источника данных: пользовательские настройки,
   * quiet hours и применимые глобальные политики — затем передаёт всё в чистую
   * функцию evaluate() из доменного слоя, которая принимает решение.
   *
   * Каждый вызов логируется с решением и причиной для observability.
   *
   * @param request - параметры уведомления: userId, тип, канал, регион, момент отправки
   * @returns решение allow/deny с кратким объяснением причины
   */
  async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
    const [userPreferences, quietHours, globalPolicies] = await Promise.all([
      this.preferencesRepo.findByUserId(request.userId),
      this.preferencesRepo.findQuietHours(request.userId),
      this.policiesRepo.findApplicable(request.notificationType, request.region),
    ]);

    const result = evaluate(request, {
      userPreferences,
      quietHours,
      globalPolicies,
      defaults: DEFAULT_PREFERENCES,
    });

    logger.info('evaluation_result', {
      userId: request.userId,
      notificationType: request.notificationType,
      channel: request.channel,
      region: request.region,
      datetime: request.datetime.toISOString(),
      decision: result.decision,
      reason: result.reason,
    });

    return result;
  }
}
