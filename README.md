# Notification Preferences Service

Сервис управления предпочтениями уведомлений — единый источник правды о том, какие уведомления и по каким каналам можно отправлять пользователю.

## Быстрый старт

### С Docker (рекомендуется)

```bash
# Запуск PostgreSQL, миграций и сервиса
docker compose up

# Сервис доступен на http://localhost:3000
```

### Без Docker

**Предварительные требования:** Node.js 20+, PostgreSQL 14+

```bash
# 1. Установить зависимости
npm install

# 2. Создать базу данных
psql -U postgres -c "CREATE DATABASE nps;"
psql -U postgres -c "CREATE DATABASE nps_test;"

# 3. Скопировать и настроить переменные окружения
cp .env.example .env

# 4. Применить схему БД
npm run migrate

# 5. Запустить сервис
npm run dev
```

## Запуск тестов

```bash
# Юнит-тесты (без БД, быстро)
npm run test:unit

# Интеграционные тесты (нужна БД nps_test)
# Убедитесь, что PostgreSQL запущен и БД nps_test создана
DB_NAME=nps_test npm run test:integration

# Все тесты
npm test
```

### Тесты через Docker

```bash
# Запустить только БД для тестов
docker compose up postgres-test -d

# Запустить интеграционные тесты
DB_PORT=5433 DB_NAME=nps_test npm run test:integration
```

## API

### GET /users/:id/preferences

Возвращает текущие предпочтения пользователя (с учётом дефолтов).

```bash
curl http://localhost:3000/users/user-1/preferences
```

```json
{
  "userId": "user-1",
  "channels": [
    { "userId": "user-1", "notificationType": "transactional_email", "channel": "email", "enabled": true, "updatedAt": "1970-01-01T00:00:00.000Z" },
    { "userId": "user-1", "notificationType": "marketing_email", "channel": "email", "enabled": false, "updatedAt": "1970-01-01T00:00:00.000Z" }
  ],
  "quietHours": null
}
```

### POST /users/:id/preferences

Изменение предпочтений. Операция идемпотентна.

```bash
curl -X POST http://localhost:3000/users/user-1/preferences \
  -H 'Content-Type: application/json' \
  -d '{
    "channelUpdates": [
      { "notificationType": "marketing_email", "channel": "email", "enabled": false }
    ],
    "quietHours": {
      "startTime": "22:00",
      "endTime": "08:00",
      "timezone": "Europe/Moscow"
    }
  }'
```

Для удаления quiet hours передайте `"quietHours": null`.

### POST /evaluate

Проверка, можно ли отправить уведомление.

```bash
curl -X POST http://localhost:3000/evaluate \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "user-1",
    "notificationType": "marketing_sms",
    "channel": "sms",
    "region": "EU",
    "datetime": "2026-05-21T21:30:00Z"
  }'
```

```json
{
  "decision": "deny",
  "reason": "blocked_by_global_policy"
}
```

Возможные значения `reason`:
- `allowed` — разрешено
- `blocked_by_global_policy` — запрещено глобальной политикой
- `disabled_by_user` — пользователь отключил уведомление (или дефолт отключён)
- `quiet_hours` — попадает в тихие часы

### POST /policies

Создание глобальной политики запрета.

```bash
curl -X POST http://localhost:3000/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "notificationType": "marketing_sms",
    "region": "EU",
    "reason": "GDPR compliance"
  }'
```

### GET /policies

Список всех активных политик.

### DELETE /policies/:id

Удаление политики.

## Типы уведомлений и каналы

| Тип | Канал |
|-----|-------|
| `transactional_email` | `email` |
| `marketing_email` | `email` |
| `transactional_sms` | `sms` |
| `marketing_sms` | `sms` |
| `transactional_push` | `push` |
| `marketing_push` | `push` |

Регионы: `EU`, `US`, `APAC`, `LATAM`, `OTHER`

## Архитектура

```
src/
├── domain/
│   ├── types.ts        # Доменные типы: NotificationType, Channel, Region, ...
│   ├── defaults.ts     # Дефолтные предпочтения для новых пользователей
│   └── evaluator.ts    # Чистая функция оценки allow/deny (без зависимостей от БД)
├── infrastructure/
│   ├── db/
│   │   ├── client.ts   # Управление пулом PostgreSQL соединений
│   │   ├── schema.sql  # Схема БД
│   │   └── migrate.ts  # Скрипт применения схемы
│   ├── repositories/
│   │   ├── preferences.repository.ts  # CRUD предпочтений и quiet hours
│   │   └── policies.repository.ts     # CRUD глобальных политик
│   └── logger.ts       # Winston logger
├── application/
│   ├── preferences.service.ts  # Бизнес-логика управления предпочтениями
│   └── evaluation.service.ts   # Оркестрация проверки разрешения
└── api/
    ├── routes/
    │   ├── users.ts     # GET/POST /users/:id/preferences
    │   ├── evaluate.ts  # POST /evaluate
    │   └── policies.ts  # CRUD /policies
    ├── middleware/
    │   ├── validate.ts       # Zod-валидация запросов
    │   └── error-handler.ts  # Глобальный обработчик ошибок
    └── app.ts           # Сборка Express-приложения (DI вручную)
```

### Ключевые архитектурные решения

**Разделение домена и инфраструктуры.** Функция `evaluate()` в `domain/evaluator.ts` — чистая (pure function): принимает данные, возвращает решение, не знает о БД. Это делает её быстро тестируемой и переносимой.

**Порядок приоритетов при оценке:**
1. Глобальные политики (наивысший приоритет)
2. Явные настройки пользователя
3. Quiet hours (только маркетинговые уведомления)
4. Дефолтные предпочтения

**Идемпотентность** обеспечивается через `INSERT ... ON CONFLICT DO UPDATE` в PostgreSQL — повторный вызов с теми же данными не создаёт дублей и не меняет состояние.

**Quiet hours и таймзоны.** Используется библиотека `luxon` для перевода UTC datetime в локальное время пользователя. Поддерживаются ночные диапазоны (например, 22:00–08:00), пересекающие полночь.

**Маркетинговые vs транзакционные.** Quiet hours блокируют только маркетинговые уведомления (`marketing_*`). Транзакционные (`transactional_*`) проходят всегда, если не отключены пользователем или глобальной политикой.

**Дефолты.** Новый пользователь получает предпочтения из `domain/defaults.ts` без записей в БД. Как только пользователь меняет настройку, она записывается и начинает приоритизироваться над дефолтами.

## Что добавить в продакшн

- **Аутентификация и авторизация** — JWT middleware, проверка что пользователь меняет только свои настройки.
- **Кэширование** — Redis для горячих путей оценки (`/evaluate`), инвалидация при изменении настроек.
- **Версионирование и аудит** — таблица `preference_history` для отслеживания изменений (кто, когда, что изменил).
- **Метрики** — счётчики `evaluation.allow`/`evaluation.deny` по типу+каналу+региону, гистограмма latency `/evaluate`. Легко добавить `prom-client` в middleware.
- **Batching** — эндпоинт `POST /evaluate/batch` для проверки нескольких уведомлений за один запрос.
- **Пагинация** в `GET /policies`.
- **Graceful degradation** — если БД недоступна, `/evaluate` может использовать только дефолты вместо возврата 500.
- **Инициализация пользователя** — явный `POST /users` для записи дефолтов в БД при регистрации (упрощает аналитику).
- **OpenAPI / Swagger** документация.
