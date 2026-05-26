import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../../src/api/app';
import { createTestPool, runMigrations, clearTables } from './helpers';

let pool: Pool;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  pool = createTestPool();
  await runMigrations(pool);
  app = createApp(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await clearTables(pool);
});

// ─── Сценарий 1: Дефолты для нового пользователя ───────────────────────────

describe('Scenario 1 — default preferences for new user', () => {
  it('returns default preferences without any stored data', async () => {
    const res = await request(app).get('/users/new-user-1/preferences').expect(200);

    const prefs: Array<{ notificationType: string; enabled: boolean }> = res.body.channels;

    const transactionalEmail = prefs.find((p) => p.notificationType === 'transactional_email');
    const marketingEmail = prefs.find((p) => p.notificationType === 'marketing_email');

    expect(transactionalEmail?.enabled).toBe(true);
    expect(marketingEmail?.enabled).toBe(false);
    expect(res.body.quietHours).toBeNull();
  });
});

// ─── Сценарий 2: Изменение настроек пользователем ──────────────────────────

describe('Scenario 2 — user modifies preferences', () => {
  it('disabling marketing_email is reflected in preferences', async () => {
    await request(app)
      .post('/users/user-2/preferences')
      .send({
        channelUpdates: [
          { notificationType: 'marketing_email', channel: 'email', enabled: false },
        ],
      })
      .expect(200);

    const res = await request(app).get('/users/user-2/preferences').expect(200);
    const prefs = res.body.channels as Array<{ notificationType: string; enabled: boolean }>;

    const marketingEmail = prefs.find((p) => p.notificationType === 'marketing_email');
    const transactionalEmail = prefs.find((p) => p.notificationType === 'transactional_email');

    expect(marketingEmail?.enabled).toBe(false);
    expect(transactionalEmail?.enabled).toBe(true);
  });

  it('evaluate returns deny for disabled channel', async () => {
    await request(app)
      .post('/users/user-2b/preferences')
      .send({
        channelUpdates: [
          { notificationType: 'marketing_email', channel: 'email', enabled: false },
        ],
      });

    const res = await request(app)
      .post('/evaluate')
      .send({
        userId: 'user-2b',
        notificationType: 'marketing_email',
        channel: 'email',
        region: 'US',
        datetime: '2026-05-21T14:00:00Z',
      })
      .expect(200);

    expect(res.body.decision).toBe('deny');
    expect(res.body.reason).toBe('disabled_by_user');
  });

  it('transactional_email still allowed when marketing_email disabled', async () => {
    await request(app)
      .post('/users/user-2c/preferences')
      .send({
        channelUpdates: [
          { notificationType: 'marketing_email', channel: 'email', enabled: false },
        ],
      });

    const res = await request(app)
      .post('/evaluate')
      .send({
        userId: 'user-2c',
        notificationType: 'transactional_email',
        channel: 'email',
        region: 'US',
        datetime: '2026-05-21T14:00:00Z',
      })
      .expect(200);

    expect(res.body.decision).toBe('allow');
  });
});

// ─── Сценарий 3: Quiet hours ────────────────────────────────────────────────

describe('Scenario 3 — quiet hours', () => {
  it('marketing_push is blocked during quiet hours', async () => {
    await request(app)
      .post('/users/user-3/preferences')
      .send({
        channelUpdates: [
          { notificationType: 'marketing_push', channel: 'push', enabled: true },
        ],
        quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'UTC' },
      });

    // 23:00 UTC — тихое время
    const res = await request(app)
      .post('/evaluate')
      .send({
        userId: 'user-3',
        notificationType: 'marketing_push',
        channel: 'push',
        region: 'US',
        datetime: '2026-05-21T23:00:00Z',
      })
      .expect(200);

    expect(res.body.decision).toBe('deny');
    expect(res.body.reason).toBe('quiet_hours');
  });

  it('marketing_push is allowed outside quiet hours', async () => {
    await request(app)
      .post('/users/user-3b/preferences')
      .send({
        channelUpdates: [
          { notificationType: 'marketing_push', channel: 'push', enabled: true },
        ],
        quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'UTC' },
      });

    const res = await request(app)
      .post('/evaluate')
      .send({
        userId: 'user-3b',
        notificationType: 'marketing_push',
        channel: 'push',
        region: 'US',
        datetime: '2026-05-21T14:00:00Z',
      })
      .expect(200);

    expect(res.body.decision).toBe('allow');
  });

  it('transactional_push is NOT blocked during quiet hours', async () => {
    await request(app)
      .post('/users/user-3c/preferences')
      .send({
        quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'UTC' },
      });

    const res = await request(app)
      .post('/evaluate')
      .send({
        userId: 'user-3c',
        notificationType: 'transactional_push',
        channel: 'push',
        region: 'US',
        datetime: '2026-05-21T23:00:00Z',
      })
      .expect(200);

    expect(res.body.decision).toBe('allow');
  });
});

// ─── Сценарий 4: Глобальные политики ────────────────────────────────────────

describe('Scenario 4 — global policies', () => {
  it('marketing_sms denied in EU due to global policy', async () => {
    // Включаем marketing_sms для пользователя
    await request(app)
      .post('/users/user-4/preferences')
      .send({
        channelUpdates: [
          { notificationType: 'marketing_sms', channel: 'sms', enabled: true },
        ],
      });

    // Создаём глобальную политику
    await request(app)
      .post('/policies')
      .send({
        notificationType: 'marketing_sms',
        region: 'EU',
        reason: 'GDPR compliance',
      })
      .expect(201);

    const res = await request(app)
      .post('/evaluate')
      .send({
        userId: 'user-4',
        notificationType: 'marketing_sms',
        channel: 'sms',
        region: 'EU',
        datetime: '2026-05-21T14:00:00Z',
      })
      .expect(200);

    expect(res.body.decision).toBe('deny');
    expect(res.body.reason).toBe('blocked_by_global_policy');
  });

  it('same notification allowed for US when EU policy exists', async () => {
    await request(app)
      .post('/users/user-4b/preferences')
      .send({
        channelUpdates: [
          { notificationType: 'marketing_sms', channel: 'sms', enabled: true },
        ],
      });

    await request(app)
      .post('/policies')
      .send({
        notificationType: 'marketing_sms',
        region: 'EU',
        reason: 'GDPR compliance',
      });

    const res = await request(app)
      .post('/evaluate')
      .send({
        userId: 'user-4b',
        notificationType: 'marketing_sms',
        channel: 'sms',
        region: 'US',
        datetime: '2026-05-21T14:00:00Z',
      })
      .expect(200);

    expect(res.body.decision).toBe('allow');
  });
});

// ─── Сценарий 5: Идемпотентность ───────────────────────────────────────────

describe('Scenario 5 — idempotency', () => {
  it('applying the same preference update twice does not break state', async () => {
    const update = {
      channelUpdates: [
        { notificationType: 'marketing_email', channel: 'email', enabled: false },
      ],
    };

    await request(app).post('/users/user-5/preferences').send(update).expect(200);
    const res = await request(app).post('/users/user-5/preferences').send(update).expect(200);

    const prefs = res.body.channels as Array<{ notificationType: string; enabled: boolean }>;
    const marketingEmail = prefs.find((p) => p.notificationType === 'marketing_email');
    expect(marketingEmail?.enabled).toBe(false);
  });

  it('double evaluation returns same result', async () => {
    const payload = {
      userId: 'user-5b',
      notificationType: 'marketing_email',
      channel: 'email',
      region: 'US',
      datetime: '2026-05-21T14:00:00Z',
    };

    const r1 = await request(app).post('/evaluate').send(payload).expect(200);
    const r2 = await request(app).post('/evaluate').send(payload).expect(200);

    expect(r1.body).toEqual(r2.body);
  });

  it('setting quiet hours twice keeps the latest value', async () => {
    await request(app)
      .post('/users/user-5c/preferences')
      .send({ quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'UTC' } });

    await request(app)
      .post('/users/user-5c/preferences')
      .send({ quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'UTC' } });

    const res = await request(app).get('/users/user-5c/preferences').expect(200);
    expect(res.body.quietHours.startTime).toBe('22:00');
    expect(res.body.quietHours.endTime).toBe('08:00');
  });
});
