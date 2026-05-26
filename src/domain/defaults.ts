import { DefaultPreference } from './types';

// Дефолтные предпочтения применяются к новым пользователям.
// Транзакционные уведомления включены, маркетинговые — выключены.
export const DEFAULT_PREFERENCES: DefaultPreference[] = [
  { notificationType: 'transactional_email', channel: 'email', enabled: true },
  { notificationType: 'marketing_email',     channel: 'email', enabled: false },
  { notificationType: 'transactional_sms',   channel: 'sms',   enabled: true },
  { notificationType: 'marketing_sms',       channel: 'sms',   enabled: false },
  { notificationType: 'transactional_push',  channel: 'push',  enabled: true },
  { notificationType: 'marketing_push',      channel: 'push',  enabled: false },
];
