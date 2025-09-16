import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../auth/index.js';

const prisma = new PrismaClient();
const router = Router();

const summarySchema = z.object({
  patient_id: z.string().uuid(),
  last_n: z.coerce.number().int().positive().max(20).optional(),
});

router.get('/patient-summary', requireAuth, async (req: Request, res: Response) => {
  const parsed = summarySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { patient_id, last_n = 3 } = parsed.data;
  const visits = await prisma.visit.findMany({
    where: { patientId: patient_id },
    orderBy: { visitDate: 'desc' },
    take: last_n,
    select: {
      visitId: true,
      visitDate: true,
      diagnoses: { select: { diagnosis: true } },
      medications: { select: { drugName: true, dosage: true, instructions: true } },
      labResults: {
        where: { testName: { in: ['HbA1c', 'LDL'] } },
        select: { testName: true, resultValue: true, unit: true, testDate: true },
      },
      observations: {
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: {
          obsId: true,
          noteText: true,
          bpSystolic: true,
          bpDiastolic: true,
          heartRate: true,
          temperatureC: true,
          spo2: true,
          bmi: true,
          createdAt: true,
        },
      },
    },
  });
  res.json({ patientId: patient_id, visits });
});

const latestSchema = z.object({ patient_id: z.string().uuid() });

router.get('/latest-visit', requireAuth, async (req: Request, res: Response) => {
  const parsed = latestSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { patient_id } = parsed.data;
  const visit = await prisma.visit.findFirst({
    where: { patientId: patient_id },
    orderBy: { visitDate: 'desc' },
    include: {
      diagnoses: { orderBy: { createdAt: 'desc' } },
      medications: { orderBy: { createdAt: 'desc' } },
      labResults: { orderBy: { createdAt: 'desc' } },
      observations: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!visit) return res.sendStatus(404);
  res.json(visit);
});

const cohortSchema = z.object({
  test_name: z.string().min(1),
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']).default('gt'),
  value: z.coerce.number(),
  months: z.coerce.number().int().positive().max(120),
});

router.get('/cohort', requireAuth, async (req: Request, res: Response) => {
  const parsed = cohortSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { test_name, op, value, months } = parsed.data;
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const resultValueFilter: Record<string, number> =
    op === 'gt'
      ? { gt: value }
      : op === 'gte'
      ? { gte: value }
      : op === 'lt'
      ? { lt: value }
      : op === 'lte'
      ? { lte: value }
      : { equals: value };

  const labs = await prisma.labResult.findMany({
    where: {
      testName: test_name,
      testDate: { not: null, gte: from },
      resultValue: { ...resultValueFilter, not: null },
    },
    orderBy: [
      { testDate: 'desc' },
      { createdAt: 'desc' },
    ],
    include: {
      visit: {
        select: {
          patientId: true,
          patient: { select: { name: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const cohort = labs
    .filter((lab) => lab.visit && lab.visit.patient)
    .reduce<Array<{ patientId: string; name: string; lastMatchingLab: { value: number; date: Date; visitId: string } }>>(
      (acc, lab) => {
        const patientId = lab.visit!.patientId;
        if (seen.has(patientId)) {
          return acc;
        }
        if (!lab.testDate || lab.resultValue === null) {
          return acc;
        }
        seen.add(patientId);
        acc.push({
          patientId,
          name: lab.visit!.patient?.name ?? '',
          lastMatchingLab: {
            value: lab.resultValue,
            date: lab.testDate,
            visitId: lab.visitId,
          },
        });
        return acc;
      },
      []
    );
  res.json(cohort);
});

export default router;
