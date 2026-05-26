import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { EvaluationService } from '../../application/evaluation.service';
import { NOTIFICATION_TYPES, CHANNELS, REGIONS } from '../../domain/types';

const evaluateBodySchema = z.object({
  userId: z.string().min(1),
  notificationType: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(CHANNELS),
  region: z.enum(REGIONS),
  datetime: z.string().datetime({ message: 'Must be ISO 8601 datetime string' }),
});

export function createEvaluateRouter(evaluationService: EvaluationService): Router {
  const router = Router();

  // POST /evaluate
  router.post('/', validate(evaluateBodySchema, 'body'), async (req, res, next) => {
    try {
      const { userId, notificationType, channel, region, datetime } = req.body as z.infer<
        typeof evaluateBodySchema
      >;

      const result = await evaluationService.evaluate({
        userId,
        notificationType,
        channel,
        region,
        datetime: new Date(datetime),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
