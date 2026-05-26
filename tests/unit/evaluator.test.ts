import { evaluate, isDuringQuietHours } from '../../src/domain/evaluator';
import { DEFAULT_PREFERENCES } from '../../src/domain/defaults';
import {
  UserChannelPreference,
  GlobalPolicy,
  QuietHours,
  EvaluationRequest,
} from '../../src/domain/types';

const BASE_USER_ID = 'user-test';

function makeRequest(overrides: Partial<EvaluationRequest> = {}): EvaluationRequest {
  return {
    userId: BASE_USER_ID,
    notificationType: 'marketing_email',
    channel: 'email',
    region: 'EU',
    datetime: new Date('2026-05-21T14:00:00Z'),
    ...overrides,
  };
}

function makePref(overrides: Partial<UserChannelPreference>): UserChannelPreference {
  return {
    userId: BASE_USER_ID,
    notificationType: 'marketing_email',
    channel: 'email',
    enabled: true,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQuietHours(overrides: Partial<QuietHours> = {}): QuietHours {
  return {
    userId: BASE_USER_ID,
    startTime: '22:00',
    endTime: '08:00',
    timezone: 'UTC',
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePolicy(overrides: Partial<GlobalPolicy> = {}): GlobalPolicy {
  return {
    id: 'policy-1',
    notificationType: 'marketing_sms',
    channel: null,
    region: 'EU',
    decision: 'deny',
    reason: 'GDPR compliance',
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Сценарий 1: Дефолтные настройки для нового пользователя ───────────────

describe('Scenario 1 — default preferences for new user', () => {
  const deps = {
    userPreferences: [],
    quietHours: null,
    globalPolicies: [],
    defaults: DEFAULT_PREFERENCES,
  };

  test('transactional_email is allowed by default', () => {
    const result = evaluate(
      makeRequest({ notificationType: 'transactional_email', channel: 'email' }),
      deps,
    );
    expect(result.decision).toBe('allow');
  });

  test('marketing_email is denied by default', () => {
    const result = evaluate(
      makeRequest({ notificationType: 'marketing_email', channel: 'email' }),
      deps,
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('disabled_by_user');
  });

  test('marketing_sms is denied by default', () => {
    const result = evaluate(
      makeRequest({ notificationType: 'marketing_sms', channel: 'sms' }),
      deps,
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('disabled_by_user');
  });

  test('transactional_push is allowed by default', () => {
    const result = evaluate(
      makeRequest({ notificationType: 'transactional_push', channel: 'push' }),
      deps,
    );
    expect(result.decision).toBe('allow');
  });
});

// ─── Сценарий 2: Изменение настроек пользователем ──────────────────────────

describe('Scenario 2 — user modifies preferences', () => {
  test('explicitly disabling marketing_email blocks it', () => {
    const deps = {
      userPreferences: [makePref({ enabled: false })],
      quietHours: null,
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    const result = evaluate(makeRequest(), deps);
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('disabled_by_user');
  });

  test('transactional_email still allowed when marketing_email is disabled', () => {
    const deps = {
      userPreferences: [makePref({ enabled: false })],
      quietHours: null,
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    const result = evaluate(
      makeRequest({ notificationType: 'transactional_email', channel: 'email' }),
      deps,
    );
    expect(result.decision).toBe('allow');
  });

  test('user can enable marketing_email (override default)', () => {
    const deps = {
      userPreferences: [makePref({ enabled: true })],
      quietHours: null,
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    const result = evaluate(makeRequest(), deps);
    expect(result.decision).toBe('allow');
  });
});

// ─── Сценарий 3: Quiet hours ────────────────────────────────────────────────

describe('Scenario 3 — quiet hours', () => {
  const enabledPref = makePref({ enabled: true });

  test('marketing_push denied during quiet hours', () => {
    const deps = {
      userPreferences: [makePref({ notificationType: 'marketing_push', channel: 'push', enabled: true })],
      quietHours: makeQuietHours({ startTime: '22:00', endTime: '08:00', timezone: 'UTC' }),
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    // 23:00 UTC — в тихое время
    const result = evaluate(
      makeRequest({
        notificationType: 'marketing_push',
        channel: 'push',
        datetime: new Date('2026-05-21T23:00:00Z'),
      }),
      deps,
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('quiet_hours');
  });

  test('marketing_push allowed outside quiet hours', () => {
    const deps = {
      userPreferences: [makePref({ notificationType: 'marketing_push', channel: 'push', enabled: true })],
      quietHours: makeQuietHours({ startTime: '22:00', endTime: '08:00', timezone: 'UTC' }),
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    // 12:00 UTC — не тихое время
    const result = evaluate(
      makeRequest({
        notificationType: 'marketing_push',
        channel: 'push',
        datetime: new Date('2026-05-21T12:00:00Z'),
      }),
      deps,
    );
    expect(result.decision).toBe('allow');
  });

  test('transactional_push NOT blocked during quiet hours', () => {
    const deps = {
      userPreferences: [makePref({ notificationType: 'transactional_push', channel: 'push', enabled: true })],
      quietHours: makeQuietHours({ startTime: '22:00', endTime: '08:00', timezone: 'UTC' }),
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    // 23:00 UTC — тихое время, но транзакционные проходят
    const result = evaluate(
      makeRequest({
        notificationType: 'transactional_push',
        channel: 'push',
        datetime: new Date('2026-05-21T23:00:00Z'),
      }),
      deps,
    );
    expect(result.decision).toBe('allow');
  });

  test('quiet hours respect timezone — user in +3 sees 22:00 local as 19:00 UTC', () => {
    const deps = {
      userPreferences: [makePref({ notificationType: 'marketing_push', channel: 'push', enabled: true })],
      quietHours: makeQuietHours({
        startTime: '22:00',
        endTime: '08:00',
        timezone: 'Europe/Moscow', // UTC+3
      }),
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    // 19:01 UTC = 22:01 Moscow — тихое время
    const result = evaluate(
      makeRequest({
        notificationType: 'marketing_push',
        channel: 'push',
        datetime: new Date('2026-05-21T19:01:00Z'),
      }),
      deps,
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('quiet_hours');
  });
});

// ─── Сценарий 4: Глобальные политики ────────────────────────────────────────

describe('Scenario 4 — global policies', () => {
  test('global policy blocks notification regardless of user setting', () => {
    const deps = {
      userPreferences: [makePref({ notificationType: 'marketing_sms', channel: 'sms', enabled: true })],
      quietHours: null,
      globalPolicies: [makePolicy({ notificationType: 'marketing_sms', channel: null, region: 'EU' })],
      defaults: DEFAULT_PREFERENCES,
    };

    const result = evaluate(
      makeRequest({ notificationType: 'marketing_sms', channel: 'sms' }),
      deps,
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('blocked_by_global_policy');
  });

  test('policy for EU does not affect US region', () => {
    const deps = {
      userPreferences: [makePref({ notificationType: 'marketing_sms', channel: 'sms', enabled: true })],
      quietHours: null,
      globalPolicies: [makePolicy({ notificationType: 'marketing_sms', channel: null, region: 'EU' })],
      defaults: DEFAULT_PREFERENCES,
    };

    const result = evaluate(
      makeRequest({ notificationType: 'marketing_sms', channel: 'sms', region: 'US' }),
      deps,
    );
    expect(result.decision).toBe('allow');
  });

  test('policy with specific channel only blocks that channel', () => {
    const deps = {
      userPreferences: [
        makePref({ notificationType: 'marketing_email', channel: 'email', enabled: true }),
      ],
      quietHours: null,
      globalPolicies: [
        makePolicy({ notificationType: 'marketing_email', channel: 'email', region: 'EU' }),
      ],
      defaults: DEFAULT_PREFERENCES,
    };

    const result = evaluate(makeRequest({ notificationType: 'marketing_email', channel: 'email' }), deps);
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('blocked_by_global_policy');
  });
});

// ─── Сценарий 5: Идемпотентность ───────────────────────────────────────────

describe('Scenario 5 — idempotency (domain logic)', () => {
  test('applying same disabled state twice yields same result', () => {
    const deps1 = {
      userPreferences: [makePref({ enabled: false })],
      quietHours: null,
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    const deps2 = {
      userPreferences: [makePref({ enabled: false })], // "повторное" применение
      quietHours: null,
      globalPolicies: [],
      defaults: DEFAULT_PREFERENCES,
    };

    const result1 = evaluate(makeRequest(), deps1);
    const result2 = evaluate(makeRequest(), deps2);

    expect(result1).toEqual(result2);
    expect(result1.decision).toBe('deny');
  });
});

// ─── isDuringQuietHours unit tests ──────────────────────────────────────────

describe('isDuringQuietHours', () => {
  const qh = makeQuietHours({ startTime: '22:00', endTime: '08:00', timezone: 'UTC' });

  test('midnight is during quiet hours', () => {
    expect(isDuringQuietHours(qh, new Date('2026-05-21T00:00:00Z'))).toBe(true);
  });

  test('22:00 is start of quiet hours (inclusive)', () => {
    expect(isDuringQuietHours(qh, new Date('2026-05-21T22:00:00Z'))).toBe(true);
  });

  test('08:00 is end of quiet hours (exclusive)', () => {
    expect(isDuringQuietHours(qh, new Date('2026-05-21T08:00:00Z'))).toBe(false);
  });

  test('12:00 is outside quiet hours', () => {
    expect(isDuringQuietHours(qh, new Date('2026-05-21T12:00:00Z'))).toBe(false);
  });

  test('daytime range works (13:00-15:00)', () => {
    const dayQh = makeQuietHours({ startTime: '13:00', endTime: '15:00', timezone: 'UTC' });
    expect(isDuringQuietHours(dayQh, new Date('2026-05-21T14:00:00Z'))).toBe(true);
    expect(isDuringQuietHours(dayQh, new Date('2026-05-21T16:00:00Z'))).toBe(false);
  });
});
