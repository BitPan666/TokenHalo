use std::{collections::BTreeMap, path::PathBuf};

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

pub(crate) const STATUS_EMPTY: &str = "empty";
pub(crate) const STATUS_OK: &str = "ok";
pub(crate) const STATUS_STALE: &str = "stale";
pub(crate) const STATUS_UNAVAILABLE: &str = "unavailable";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum StatsGranularity {
    Day,
    Week,
    Month,
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
}

impl TokenTotals {
    pub(crate) fn saturating_add_assign(&mut self, other: Self) -> bool {
        let mut overflowed = false;
        overflowed |= saturating_add(&mut self.total_tokens, other.total_tokens);
        overflowed |= saturating_add(&mut self.input_tokens, other.input_tokens);
        overflowed |= saturating_add(&mut self.cached_input_tokens, other.cached_input_tokens);
        overflowed |= saturating_add(&mut self.output_tokens, other.output_tokens);
        overflowed |= saturating_add(&mut self.reasoning_tokens, other.reasoning_tokens);
        overflowed
    }
}

fn saturating_add(target: &mut u64, value: u64) -> bool {
    if let Some(total) = target.checked_add(value) {
        *target = total;
        false
    } else {
        *target = u64::MAX;
        true
    }
}

pub type DailySessionTotals = BTreeMap<NaiveDate, BTreeMap<PathBuf, TokenTotals>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatsBucket {
    pub key: String,
    pub label: String,
    pub range_start: String,
    pub range_end: String,
    pub totals: TokenTotals,
    pub task_count: u64,
    pub peak_task_tokens: u64,
    pub is_future: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatsSnapshot {
    pub status: String,
    pub granularity: StatsGranularity,
    pub buckets: Vec<TokenStatsBucket>,
    pub updated_at: String,
    pub message: Option<String>,
    pub partial: bool,
}
