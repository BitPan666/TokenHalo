import { useCallback, useEffect, useRef, useState } from "react";
import type { StatsGranularity, TokenStatsSnapshot } from "../types";
import { fetchTokenStats } from "./tokenStats";

const REFRESH_INTERVAL_MS = 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UseTokenStatsResult {
  snapshot: TokenStatsSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: (force?: boolean) => Promise<void>;
}

interface TokenStatsSettlement {
  granularity: StatsGranularity;
  error: string | null;
}

export function useTokenStats(
  active: boolean,
  granularity: StatsGranularity,
): UseTokenStatsResult {
  const [snapshot, setSnapshot] = useState<TokenStatsSnapshot | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [settlement, setSettlement] = useState<TokenStatsSettlement | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async (force = true) => {
    if (!active) return;
    const currentRequest = ++requestId.current;
    setRequestLoading(true);
    setSettlement((current) => (
      current?.granularity === granularity
        ? { granularity, error: null }
        : current
    ));
    try {
      const next = await fetchTokenStats(granularity, force);
      if (requestId.current !== currentRequest) return;
      setSnapshot(next);
      setSettlement({ granularity, error: null });
    } catch (cause) {
      if (requestId.current !== currentRequest) return;
      setSettlement({ granularity, error: errorMessage(cause) });
    } finally {
      if (requestId.current === currentRequest) {
        setRequestLoading(false);
      }
    }
  }, [active, granularity]);

  useEffect(() => {
    if (!active) {
      requestId.current += 1;
      setRequestLoading(false);
      return;
    }

    void refresh(false);
    const interval = window.setInterval(() => {
      void refresh(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      requestId.current += 1;
    };
  }, [active, refresh]);

  const currentSettled = settlement?.granularity === granularity;
  return {
    snapshot,
    loading: active && (requestLoading || !currentSettled),
    error: currentSettled ? settlement.error : null,
    refresh,
  };
}
