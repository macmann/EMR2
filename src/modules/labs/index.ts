import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "../auth/index.js";
import { logDataChange } from "../audit/index.js";

const prisma = new PrismaClient();
const router = Router();

const labSchema = z.object({
  testName: z.string().min(1),
  resultValue: z.number().optional(),
  unit: z.string().optional(),
  referenceRange: z.string().optional(),
  testDate: z.coerce.date().optional(),
});

router.post(
  "/visits/:id/labs",
  requireAuth,
  requireRole("Doctor", "Admin"),
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    try {
      z.string().uuid().parse(id);
    } catch {
      return res.status(400).json({ error: "invalid id" });
    }
    const parsed = labSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const lab = await prisma.labResult.create({
      data: { visitId: id, ...parsed.data },
    });
    await logDataChange(req.user!.userId, "lab", lab.labId, undefined, lab);
    res.status(201).json(lab);
  }
);

router.get(
  "/",
  requireAuth,
  requireRole("Doctor", "Admin"),
  async (req: Request, res: Response) => {
    const querySchema = z.object({
      patient_id: z.string().uuid().optional(),
      test_name: z.string().optional(),
      min: z.coerce.number().optional(),
      max: z.coerce.number().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const {
      patient_id,
      test_name,
      min,
      max,
      from,
      to,
      limit = 20,
      offset = 0,
    } = parsed.data;
    const where: any = {};
    if (patient_id) {
      where.visit = { patientId: patient_id };
    }
    if (test_name) {
      // Use raw SQL for MySQL case-insensitive search
      const labs = await prisma.$queryRaw`
      SELECT labId, visitId, testName, resultValue, unit, referenceRange, testDate, createdAt
      FROM LabResult
      WHERE LOWER(testName) LIKE LOWER(${`%${test_name}%`})
        ${
          patient_id
            ? Prisma.sql`AND visitId IN (SELECT visitId FROM Visit WHERE patientId = ${patient_id})`
            : Prisma.empty
        }
        ${
          min !== undefined
            ? Prisma.sql`AND resultValue >= ${min}`
            : Prisma.empty
        }
        ${
          max !== undefined
            ? Prisma.sql`AND resultValue <= ${max}`
            : Prisma.empty
        }
        ${from ? Prisma.sql`AND testDate >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND testDate <= ${to}` : Prisma.empty}
      ORDER BY testDate DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
      return res.json(labs);
    }
    if (min !== undefined || max !== undefined) {
      where.resultValue = {
        ...(min !== undefined && { gte: min }),
        ...(max !== undefined && { lte: max }),
      };
    }
    if (from || to) {
      where.testDate = {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      };
    }
    const labs = await prisma.labResult.findMany({
      where,
      orderBy: { testDate: "desc" },
      take: limit,
      skip: offset,
    });
    res.json(labs);
  }
);

export default router;
