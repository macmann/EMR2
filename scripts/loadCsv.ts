import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient, Gender } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

type Row = Record<string, string>;

function readCsv(filename: string): Row[] {
  const filePath = path.resolve(__dirname, "../prisma/data", filename);
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split(/\r?\n/);
  const headerLine = lines.shift();
  if (!headerLine) return [];
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(",");
      const row: Row = {};
      headers.forEach((h, i) => {
        row[h] = values[i] ? values[i].trim() : "";
      });
      return row;
    });
}

async function main() {
  const patientMap = new Map<string, string>();
  const doctorMap = new Map<string, string>();
  const visitMap = new Map<string, string>();

  const inserted = {
    patients: 0,
    doctors: 0,
    visits: 0,
    diagnoses: 0,
    medications: 0,
    labs: 0,
    observations: 0,
  };
  const updated = {
    patients: 0,
    doctors: 0,
    visits: 0,
    diagnoses: 0,
    medications: 0,
    labs: 0,
    observations: 0,
  };

  // Patients
  for (const row of readCsv("patients.csv")) {
    const legacyId = row.patientId;
    const dob = new Date(row.dob);
    const existing = await prisma.patient.findFirst({
      where: { name: row.name, dob },
    });
    let patient;
    if (existing) {
      patient = await prisma.patient.update({
        where: { patientId: existing.patientId },
        data: {
          gender: row.gender as Gender,
          contact: row.contact || null,
          insurance: row.insurance || null,
        },
      });
      updated.patients += 1;
    } else {
      patient = await prisma.patient.create({
        data: {
          name: row.name,
          dob,
          gender: row.gender as Gender,
          contact: row.contact || null,
          insurance: row.insurance || null,
        },
      });
      inserted.patients += 1;
    }
    if (legacyId) patientMap.set(legacyId, patient.patientId);
  }

  // Doctors
  for (const row of readCsv("doctors.csv")) {
    const legacyId = row.doctorId;
    const existing = await prisma.doctor.findFirst({
      where: { name: row.name, department: row.department },
    });
    let doctor;
    if (existing) {
      doctor = await prisma.doctor.update({
        where: { doctorId: existing.doctorId },
        data: {},
      });
      updated.doctors += 1;
    } else {
      doctor = await prisma.doctor.create({
        data: { name: row.name, department: row.department },
      });
      inserted.doctors += 1;
    }
    if (legacyId) doctorMap.set(legacyId, doctor.doctorId);
  }

  // Visits
  for (const row of readCsv("visits.csv")) {
    const legacyId = row.visitId;
    const patientId = patientMap.get(row.patientId);
    const doctorId = doctorMap.get(row.doctorId);
    if (!patientId || !doctorId) continue;
    const visitDate = new Date(row.visitDate);
    const existing = await prisma.visit.findFirst({
      where: { patientId, doctorId, visitDate },
    });
    let visit;
    if (existing) {
      visit = await prisma.visit.update({
        where: { visitId: existing.visitId },
        data: { department: row.department, reason: row.reason || null },
      });
      updated.visits += 1;
    } else {
      visit = await prisma.visit.create({
        data: {
          patientId,
          doctorId,
          visitDate,
          department: row.department,
          reason: row.reason || null,
        },
      });
      inserted.visits += 1;
    }
    if (legacyId) visitMap.set(legacyId, visit.visitId);
  }

  // Diagnoses
  for (const row of readCsv("diagnoses.csv")) {
    const visitId = visitMap.get(row.visitId);
    if (!visitId) continue;
    const existing = await prisma.diagnosis.findFirst({
      where: { visitId, diagnosis: row.diagnosis },
    });
    if (existing) {
      updated.diagnoses += 1;
    } else {
      await prisma.diagnosis.create({
        data: { visitId, diagnosis: row.diagnosis },
      });
      inserted.diagnoses += 1;
    }
  }

  // Medications
  for (const row of readCsv("medications.csv")) {
    const visitId = visitMap.get(row.visitId);
    if (!visitId) continue;
    const drugName = row.drugName || row.drug;
    const existing = await prisma.medication.findFirst({
      where: { visitId, drugName },
    });
    if (existing) {
      await prisma.medication.update({
        where: { medId: existing.medId },
        data: {
          dosage: row.dosage || null,
          instructions: row.instructions || null,
        },
      });
      updated.medications += 1;
    } else {
      await prisma.medication.create({
        data: {
          visitId,
          drugName,
          dosage: row.dosage || null,
          instructions: row.instructions || null,
        },
      });
      inserted.medications += 1;
    }
  }

  // Lab results
  for (const row of readCsv("lab_results.csv")) {
    const visitId = visitMap.get(row.visitId);
    if (!visitId) continue;
    const testName = row.testName;
    const testDate = row.testDate ? new Date(row.testDate) : null;
    const existing = await prisma.labResult.findFirst({
      where: { visitId, testName, testDate },
    });
    if (existing) {
      await prisma.labResult.update({
        where: { labId: existing.labId },
        data: {
          resultValue: row.resultValue ? parseFloat(row.resultValue) : null,
          unit: row.unit || null,
          referenceRange: row.referenceRange || null,
          testDate,
        },
      });
      updated.labs += 1;
    } else {
      await prisma.labResult.create({
        data: {
          visitId,
          testName,
          resultValue: row.resultValue ? parseFloat(row.resultValue) : null,
          unit: row.unit || null,
          referenceRange: row.referenceRange || null,
          testDate,
        },
      });
      inserted.labs += 1;
    }
  }

  // Observations (from reports.csv)
  for (const row of readCsv("reports.csv")) {
    const visitId = visitMap.get(row.visitId);
    const patientId = patientMap.get(row.patientId);
    const doctorId = doctorMap.get(row.doctorId);
    if (!visitId || !patientId || !doctorId) continue;

    const existing = await prisma.observation.findFirst({
      where: {
        visitId,
        noteText: row.noteText,
        createdAt: new Date(row.createdAt),
      },
    });

    if (existing) {
      await prisma.observation.update({
        where: { obsId: existing.obsId },
        data: {
          bpSystolic: row.bpSystolic ? parseInt(row.bpSystolic) : null,
          bpDiastolic: row.bpDiastolic ? parseInt(row.bpDiastolic) : null,
          heartRate: row.heartRate ? parseInt(row.heartRate) : null,
          temperatureC: row.temperatureC ? parseFloat(row.temperatureC) : null,
          spo2: row.spo2 ? parseInt(row.spo2) : null,
          bmi: row.bmi ? parseFloat(row.bmi) : null,
        },
      });
      updated.observations += 1;
    } else {
      await prisma.observation.create({
        data: {
          obsId: row.obsId,
          visitId,
          patientId,
          doctorId,
          noteText: row.noteText,
          bpSystolic: row.bpSystolic ? parseInt(row.bpSystolic) : null,
          bpDiastolic: row.bpDiastolic ? parseInt(row.bpDiastolic) : null,
          heartRate: row.heartRate ? parseInt(row.heartRate) : null,
          temperatureC: row.temperatureC ? parseFloat(row.temperatureC) : null,
          spo2: row.spo2 ? parseInt(row.spo2) : null,
          bmi: row.bmi ? parseFloat(row.bmi) : null,
          createdAt: new Date(row.createdAt),
        },
      });
      inserted.observations += 1;
    }
  }

  console.log(
    `Patients inserted: ${inserted.patients}, updated: ${updated.patients}`
  );
  console.log(
    `Doctors inserted: ${inserted.doctors}, updated: ${updated.doctors}`
  );
  console.log(
    `Visits inserted: ${inserted.visits}, updated: ${updated.visits}`
  );
  console.log(
    `Diagnoses inserted: ${inserted.diagnoses}, updated: ${updated.diagnoses}`
  );
  console.log(
    `Medications inserted: ${inserted.medications}, updated: ${updated.medications}`
  );
  console.log(
    `Lab results inserted: ${inserted.labs}, updated: ${updated.labs}`
  );
  console.log(
    `Observations inserted: ${inserted.observations}, updated: ${updated.observations}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
