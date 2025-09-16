import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "../auth/index.js";

const prisma = new PrismaClient();
const router = Router();

const querySchema = z.object({
  department: z.string().optional(),
  q: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  department: z.string().min(1),
});

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query" });
  }
  const { department, q } = parsed.data;

  // Use raw SQL for MySQL case-insensitive search
  if (department || q) {
    let sql = "SELECT doctorId, name, department, createdAt FROM Doctor WHERE ";
    const conditions = [];

    if (department) {
      conditions.push("LOWER(department) LIKE LOWER(?)");
    }
    if (q) {
      conditions.push("LOWER(name) LIKE LOWER(?)");
    }

    sql += conditions.join(" AND ") + " ORDER BY name ASC";

    const doctors = await prisma.$queryRawUnsafe(
      sql,
      ...(department ? [`%${department}%`] : []),
      ...(q ? [`%${q}%`] : [])
    );
    return res.json(doctors);
  }

  // No filters - return all doctors
  const doctors = await prisma.doctor.findMany({ orderBy: { name: "asc" } });
  res.json(doctors);
});

router.post(
  "/",
  requireAuth,
  requireRole("Admin"),
  async (req: AuthRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const doctor = await prisma.doctor.create({ data: parsed.data });
    res.status(201).json(doctor);
  }
);

export default router;
