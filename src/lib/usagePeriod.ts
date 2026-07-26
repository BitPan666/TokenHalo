export type UsagePeriod =
  | { kind: "fiveHour" }
  | { kind: "weekly" }
  | { kind: "hours"; value: number }
  | { kind: "days"; value: number }
  | { kind: "current" };

const FIVE_HOURS = 18_000;
const ONE_WEEK = 604_800;
const TOLERANCE = 60;

const near = (value: number, expected: number) =>
  value > 0 && Math.abs(value - expected) <= TOLERANCE;

export function classifyUsagePeriod(windowSeconds: number): UsagePeriod {
  if (near(windowSeconds, FIVE_HOURS)) return { kind: "fiveHour" };
  if (near(windowSeconds, ONE_WEEK)) return { kind: "weekly" };
  if (windowSeconds > 0 && windowSeconds % 86_400 === 0) {
    return { kind: "days", value: windowSeconds / 86_400 };
  }
  if (windowSeconds > 0 && windowSeconds % 3_600 === 0) {
    return { kind: "hours", value: windowSeconds / 3_600 };
  }
  return { kind: "current" };
}
