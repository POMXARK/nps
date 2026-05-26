import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { validate } from '../middleware/validate';
import { IPoliciesRepository } from '../../infrastructure/repositories/policies.repository';
import { NOTIFICATION_TYPES, CHANNELS, REGIONS } from '../../domain/types';

const createPolicySchema = z.object({
  notificationType: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(CHANNELS).nullable().optional(),
  region: z.enum(REGIONS),
  reason: z.string().min(1),
});

export function createPoliciesRouter(policiesRepo: IPoliciesRepository): Router {
  const router = Router();

  // GET /policies
  router.get('/', async (_req, res, next) => {
    try {
      const policies = await policiesRepo.findAll();
      res.json(policies);
    } catch (err) {
      next(err);
    }
  });

  // POST /policies
  router.post('/', validate(createPolicySchema, 'body'), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createPolicySchema>;
      const policy = await policiesRepo.create({
        id: uuidv4(),
        notificationType: body.notificationType,
        channel: body.channel ?? null,
        region: body.region,
        decision: 'deny',
        reason: body.reason,
      });
      res.status(201).json(policy);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /policies/:id
  router.delete('/:id', async (req, res, next) => {
    try {
      await policiesRepo.deleteById(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
