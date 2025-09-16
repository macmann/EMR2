import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthRequest } from '../auth/index.js';
import { logDataChange } from '../audit/index.js';

const prisma = new PrismaClient();
const router = Router();

const observationSchema = z.object({
  noteText: z.string().min(1),
  bpSystolic: z.coerce.number().int().optional(),
  bpDiastolic: z.coerce.number().int().optional(),
  heartRate: z.coerce.number().int().optional(),
  temperatureC: z.coerce.number().optional(),
  spo2: z.coerce.number().int().optional(),
  bmi: z.coerce.number().optional(),
});

router.post('/visits/:id/observations', requireAuth, requireRole('Doctor'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    z.string().uuid().parse(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }
  const visit = await prisma.visit.findUnique({ where: { visitId: id } });
  if (!visit) return res.sendStatus(404);
  const parsed = observationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const obs = await prisma.observation.create({
    data: {
      visitId: id,
      patientId: visit.patientId,
      doctorId: visit.doctorId,
      ...parsed.data,
    },
  });
  await logDataChange(req.user!.userId, 'observation', obs.obsId, undefined, obs);
  res.status(201).json(obs);
});

router.get('/visits/:id/observations', requireAuth, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    z.string().uuid().parse(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }
  const visit = await prisma.visit.findUnique({ where: { visitId: id }, select: { patientId: true, visitDate: true } });
  if (!visit) return res.sendStatus(404);

  const querySchema = z.object({
    scope: z.enum(['visit', 'patient']).default('visit'),
    author: z.enum(['me', 'any']).default('any'),
    before: z.enum(['visit', 'none']).default('none'),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().positive().max(50).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { scope, author, before, order, limit = 20, offset = 0 } = parsed.data;

  if (scope === 'patient' && author === 'me' && before === 'visit') {
    const rows = await prisma.observation.findMany({
      where: {
        patientId: visit.patientId,
        doctorId: req.user!.userId,
        visit: { visitDate: { lt: visit.visitDate } },
      },
      orderBy: { createdAt: order },
      take: limit,
      skip: offset,
    });
    return res.json(rows);
  }

  const where: any = {};
  if (scope === 'visit') {
    where.visitId = id;
  } else {
    where.patientId = visit.patientId;
    if (before === 'visit') {
      where.visit = { visitDate: { lt: visit.visitDate } };
    }
  }
  if (author === 'me') {
    where.doctorId = req.user!.userId;
  }
  const observations = await prisma.observation.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  });
  res.json(observations);
});

router.get('/patients/:patientId/observations', requireAuth, async (req: AuthRequest, res: Response) => {
  const { patientId } = req.params;
  try {
    z.string().uuid().parse(patientId);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }

  const querySchema = z.object({
    author: z.enum(['me', 'any']).default('any'),
    before_visit: z.string().uuid().optional(),
    exclude_visit: z.string().uuid().optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().positive().max(50).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { author, before_visit, exclude_visit, order, limit = 20, offset = 0 } = parsed.data;

  let beforeDate: Date | undefined;
  if (before_visit) {
    const v = await prisma.visit.findUnique({ where: { visitId: before_visit }, select: { visitDate: true, patientId: true } });
    if (!v || v.patientId !== patientId) {
      return res.status(400).json({ error: 'invalid before_visit' });
    }
    beforeDate = v.visitDate;
  }

  if (author === 'me' && beforeDate) {
    const rows = await prisma.observation.findMany({
      where: {
        patientId,
        doctorId: req.user!.userId,
        ...(exclude_visit ? { visitId: { not: exclude_visit } } : {}),
        visit: { visitDate: { lt: beforeDate } },
      },
      orderBy: { createdAt: order },
      take: limit,
      skip: offset,
    });
    return res.json(rows);
  }

  const where: any = { patientId };
  if (exclude_visit) where.visitId = { not: exclude_visit };
  if (beforeDate) {
    where.visit = { visitDate: { lt: beforeDate } };
  }
  if (author === 'me') {
    where.doctorId = req.user!.userId;
  }
  const observations = await prisma.observation.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  });
  res.json(observations);
});

export default router;
