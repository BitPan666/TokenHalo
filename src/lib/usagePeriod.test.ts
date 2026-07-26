import { describe, expect, it } from "vitest";
import { copy } from "./i18n";
import { classifyUsagePeriod } from "./usagePeriod";

describe("classifyUsagePeriod", () => {
  it.each([17_940, 18_000, 18_060])("recognizes the five-hour tolerance at %i", (seconds) => {
    expect(classifyUsagePeriod(seconds)).toEqual({ kind: "fiveHour" });
  });

  it.each([604_740, 604_800, 604_860])("recognizes the weekly tolerance at %i", (seconds) => {
    expect(classifyUsagePeriod(seconds)).toEqual({ kind: "weekly" });
  });

  it.each([17_939, 18_061, 604_739, 604_861])(
    "keeps the exclusive just-outside boundary generic at %i",
    (seconds) => {
      expect(classifyUsagePeriod(seconds)).toEqual({ kind: "current" });
    },
  );

  it("keeps a positive non-clean duration generic", () => {
    expect(classifyUsagePeriod(3_601)).toEqual({ kind: "current" });
  });

  it("uses clean day and hour units for custom periods", () => {
    expect(classifyUsagePeriod(86_400)).toEqual({ kind: "days", value: 1 });
    expect(classifyUsagePeriod(43_200)).toEqual({ kind: "hours", value: 12 });
  });

  it("uses current-period semantics when duration is absent", () => {
    expect(classifyUsagePeriod(0)).toEqual({ kind: "current" });
  });
});

it("formats recognized and custom primary labels in both languages", () => {
  expect(copy["zh-CN"].usagePeriodRemaining({ kind: "fiveHour" })).toBe("5 小时额度剩余");
  expect(copy["zh-CN"].usagePeriodRemaining({ kind: "weekly" })).toBe("一周额度剩余");
  expect(copy.en.usagePeriodRemaining({ kind: "days", value: 2 })).toBe("2-day usage remaining");
  expect(copy.en.usagePeriodRemaining({ kind: "current" })).toBe("Current-period usage remaining");
});

it("formats complete accessible remaining labels", () => {
  expect(copy["zh-CN"].usageAvailableLabel({ kind: "weekly" }, 64)).toBe("一周额度剩余 64%");
  expect(copy.en.usageAvailableLabel({ kind: "hours", value: 12 }, 73)).toBe("12-hour usage remaining 73%");
});

it("combines an optional plan with the localized update subtitle", () => {
  expect(copy["zh-CN"].cardUpdatedAt("PROLITE", "7月25日 20:00")).toBe("PROLITE · 更新于 7月25日 20:00");
  expect(copy.en.cardUpdatedAt(null, "Jul 25, 8:00 PM")).toBe("Updated Jul 25, 8:00 PM");
});
