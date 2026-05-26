import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { PreferencesService } from '../../application/preferences.service';
import {
  NOTIFICATION_TYPES,
  CHANNELS,
} from '../../domain/types';

const updateBodySchema = z.object({
  channelUpdates: z
    .array(
      z.object({
        notificationType: z.enum(NOTIFICATION_TYPES),
        channel: z.enum(CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .optional(),
  quietHours: z
    .union([
      z.object({
        startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM'),
        endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM'),
        timezone: z.string().min(1),
      }),
      z.null(),
    ])
    .optional(),
});

export function createUsersRouter(preferencesService: PreferencesService): Router {
  const router = Router();

  // GET /users/:id/preferences
  router.get('/:id/preferences', async (req, res, next) => {
    try {
      const prefs = await preferencesService.getUserPreferences(req.params.id);
      res.json(prefs);
    } catch (err) {
      next(err);
    }
  });

  // POST /users/:id/preferences
  router.post(
    '/:id/preferences',
    validate(updateBodySchema, 'body'),
    async (req, res, next) => {
      try {
        const updated = await preferencesService.updatePreferences({
          userId: req.params.id,
          ...req.body,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
