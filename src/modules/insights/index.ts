import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../auth/index.js";

const prisma = new PrismaClient();
const router = Router();

const summarySchema = z.object({
  patient_id: z.string().uuid(),
  last_n: z.coerce.number().int().positive().max(20).optional(),
});

router.get(
  "/patient-summary",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = summarySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { patient_id, last_n = 3 } = parsed.data;
    const visits = await prisma.visit.findMany({
      where: { patientId: patient_id },
      orderBy: { visitDate: "desc" },
      take: last_n,
      select: {
        visitId: true,
        visitDate: true,
        diagnoses: { select: { diagnosis: true } },
        medications: {
          select: { drugName: true, dosage: true, instructions: true },
        },
        labResults: {
          where: { testName: { in: ["HbA1c", "LDL"] } },
          select: {
            testName: true,
            resultValue: true,
            unit: true,
            testDate: true,
          },
        },
        observations: {
          orderBy: { createdAt: "desc" },
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
  }
);

const latestSchema = z.object({ patient_id: z.string().uuid() });

router.get(
  "/latest-visit",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = latestSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { patient_id } = parsed.data;
    const visit = await prisma.visit.findFirst({
      where: { patientId: patient_id },
      orderBy: { visitDate: "desc" },
      include: {
        diagnoses: { orderBy: { createdAt: "desc" } },
        medications: { orderBy: { createdAt: "desc" } },
        labResults: { orderBy: { createdAt: "desc" } },
        observations: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!visit) return res.sendStatus(404);
    res.json(visit);
  }
);

const cohortSchema = z.object({
  test_name: z.string().min(1),
  op: z.enum(["gt", "gte", "lt", "lte", "eq"]).default("gt"),
  value: z.coerce.number(),
  months: z.coerce.number().int().positive().max(120),
});

router.get("/cohort", requireAuth, async (req: Request, res: Response) => {
  const parsed = cohortSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { test_name, op, value, months } = parsed.data;
  const opMap: Record<string, string> = {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    eq: "=",
  };
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const results = await prisma.$queryRaw<
    Array<{
      patientId: string;
      name: string;
      value: number;
      date: Date;
      visitId: string;
    }>
  >(
    Prisma.sql`SELECT p.patientId, p.name, l.resultValue AS value, l.testDate AS date, l.visitId
      FROM LabResult l
      JOIN Visit v ON l.visitId = v.visitId
      JOIN Patient p ON v.patientId = p.patientId
      JOIN (
        SELECT p2.patientId, MAX(l2.testDate) as maxDate
        FROM LabResult l2
        JOIN Visit v2 ON l2.visitId = v2.visitId
        JOIN Patient p2 ON v2.patientId = p2.patientId
        WHERE l2.testName = ${test_name}
          AND l2.testDate >= ${from}
          AND l2.resultValue ${Prisma.raw(opMap[op])} ${value}
          AND l2.resultValue IS NOT NULL
          AND l2.testDate IS NOT NULL
        GROUP BY p2.patientId
      ) latest ON p.patientId = latest.patientId AND l.testDate = latest.maxDate
      WHERE l.testName = ${test_name}
        AND l.testDate >= ${from}
        AND l.resultValue ${Prisma.raw(opMap[op])} ${value}
        AND l.resultValue IS NOT NULL
        AND l.testDate IS NOT NULL
      ORDER BY p.patientId, l.testDate DESC`
  );
  const cohort = results.map((r) => ({
    patientId: r.patientId,
    name: r.name,
    lastMatchingLab: { value: r.value, date: r.date, visitId: r.visitId },
  }));
  res.json(cohort);
});

export default router;
