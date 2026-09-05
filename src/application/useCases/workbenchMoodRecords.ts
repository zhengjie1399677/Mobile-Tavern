import {
  readWorkbenchMoodStorage,
  writeWorkbenchMoodStorage,
} from "../../infrastructure/workbench/workbenchMoodStorage";

export interface WorkbenchMoodPoint {
  x: number;
  y: number;
  updatedAt: number;
}

let memoryMoodRecords: Record<string, WorkbenchMoodPoint> = {};

export function readWorkbenchMoodRecords(): Record<string, WorkbenchMoodPoint> {
  const parsed = readWorkbenchMoodStorage();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return memoryMoodRecords;
  const records = Object.fromEntries(Object.entries(parsed).flatMap(([dateKey, value]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const point = value as Record<string, unknown>;
    return typeof point.x === "number" && Number.isFinite(point.x)
      && typeof point.y === "number" && Number.isFinite(point.y)
      && typeof point.updatedAt === "number" && Number.isFinite(point.updatedAt)
      ? [[dateKey, {
          x: clampAxis(point.x),
          y: clampAxis(point.y),
          updatedAt: point.updatedAt,
        } satisfies WorkbenchMoodPoint]]
      : [];
  }));
  memoryMoodRecords = records;
  return records;
}

export function saveWorkbenchMoodRecord(
  dateKey: string,
  point: Pick<WorkbenchMoodPoint, "x" | "y">,
): Record<string, WorkbenchMoodPoint> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("WORKBENCH_MOOD_DATE_INVALID");
  const next = {
    ...readWorkbenchMoodRecords(),
    [dateKey]: {
      x: Number(clampAxis(point.x).toFixed(2)),
      y: Number(clampAxis(point.y).toFixed(2)),
      updatedAt: Date.now(),
    },
  };
  memoryMoodRecords = next;
  writeWorkbenchMoodStorage(next);
  return next;
}

function clampAxis(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}
