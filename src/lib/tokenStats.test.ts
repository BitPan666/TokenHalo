import { describe, expect, it } from "vitest";
import { fetchTokenStats } from "./tokenStats";

describe("fetchTokenStats browser fallback", () => {
  it("returns exactly seven local daily buckets for the near-seven-day view", async () => {
    const snapshot = await fetchTokenStats("day");

    expect(snapshot.buckets).toHaveLength(7);
    expect(snapshot.buckets.map((bucket) => bucket.label)).toEqual([
      "7/17",
      "7/18",
      "7/19",
      "7/20",
      "7/21",
      "7/22",
      "7/23",
    ]);
  });

  it("keeps twelve buckets for the near-twelve-week view", async () => {
    const snapshot = await fetchTokenStats("week");

    expect(snapshot.buckets).toHaveLength(12);
  });
});
