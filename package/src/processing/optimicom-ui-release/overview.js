import { OPTIMICOM_LABELS, validateSourceDataset } from "./source-dataset.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = [
  ["1d", 1],
  ["7d", 7],
  ["30d", 30],
];

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function parseDate(value, context) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) fail("OVERVIEW_INVALID_DATE", `${context} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) fail("OVERVIEW_INVALID_DATE", `${context} is not a real calendar date`);
  return date;
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = parseDate(value, "date");
  date.setUTCDate(date.getUTCDate() + days);
  return dateString(date);
}

function emptyCounts() {
  return Object.fromEntries(OPTIMICOM_LABELS.map((label) => [label, 0]));
}

function makeDaily(dataset, endDate) {
  const byDate = new Map();
  for (const record of dataset.records) {
    parseDate(record.postedDate, "source dataset postedDate");
    const counts = byDate.get(record.postedDate) ?? { observation_count: 0, counts: emptyCounts() };
    counts.observation_count += 1;
    counts.counts[record.label] += 1;
    byDate.set(record.postedDate, counts);
  }
  return Array.from({ length: 30 }, (_, index) => {
    const date = addDays(endDate, index - 29);
    const value = byDate.get(date);
    return value
      ? { date, observation_count: value.observation_count, counts: { ...value.counts } }
      : { date, observation_count: null, counts: null };
  });
}

function buildPeriod(daily, endDate, days) {
  const startDate = addDays(endDate, -(days - 1));
  const rows = daily.filter((row) => row.date >= startDate && row.date <= endDate);
  const counts = emptyCounts();
  let observationCount = 0;
  for (const row of rows) {
    if (row.observation_count === null) continue;
    observationCount += row.observation_count;
    for (const label of OPTIMICOM_LABELS) counts[label] += row.counts[label];
  }
  return {
    days,
    start_date: startDate,
    end_date: endDate,
    coverage: rows.every((row) => row.observation_count !== null) ? "complete" : "partial",
    observation_count: observationCount,
    counts,
  };
}

export function buildOverviewArtifact(dataset) {
  validateSourceDataset(dataset);
  if (dataset.records.length === 0) fail("OVERVIEW_DATE_ANCHOR_MISSING", "source dataset needs at least one record");
  const dates = dataset.records.map((record) => record.postedDate).sort();
  const dataStartDate = dates[0];
  const dataEndDate = dates[dates.length - 1];
  parseDate(dataStartDate, "data_start_date");
  parseDate(dataEndDate, "data_end_date");
  const daily = makeDaily(dataset, dataEndDate);
  const periods = Object.fromEntries(PERIODS.map(([key, days]) => [key, buildPeriod(daily, dataEndDate, days)]));
  return {
    schema_version: 1,
    data_start_date: dataStartDate,
    data_end_date: dataEndDate,
    periods,
    daily,
  };
}

export function validateOverviewArtifact(overview) {
  if (!overview || typeof overview !== "object" || Array.isArray(overview) || overview.schema_version !== 1) {
    fail("OVERVIEW_INVALID", "overview schema_version must be 1");
  }
  parseDate(overview.data_start_date, "overview.data_start_date");
  parseDate(overview.data_end_date, "overview.data_end_date");
  if (!Array.isArray(overview.daily) || overview.daily.length !== 30) fail("OVERVIEW_INVALID", "daily must contain exactly 30 rows");
  for (let index = 0; index < overview.daily.length; index += 1) {
    const row = overview.daily[index];
    const expected = addDays(overview.data_end_date, index - 29);
    if (!row || row.date !== expected) fail("OVERVIEW_INVALID", `daily[${index}] date is not contiguous`);
    if (row.observation_count === null) {
      if (row.counts !== null) fail("OVERVIEW_INVALID", `daily[${index}] null observation must have null counts`);
      continue;
    }
    if (!Number.isSafeInteger(row.observation_count) || row.observation_count < 1 || !row.counts) fail("OVERVIEW_INVALID", `daily[${index}] observation row is invalid`);
    let total = 0;
    for (const label of OPTIMICOM_LABELS) {
      if (!Number.isSafeInteger(row.counts[label]) || row.counts[label] < 0) fail("OVERVIEW_INVALID", `daily[${index}] count is invalid`);
      total += row.counts[label];
    }
    if (total !== row.observation_count) fail("OVERVIEW_INVALID", `daily[${index}] label counts do not sum to observations`);
  }
  for (const [key, days] of PERIODS) {
    const period = overview.periods?.[key];
    if (!period || period.days !== days || period.start_date !== addDays(overview.data_end_date, -(days - 1)) || period.end_date !== overview.data_end_date) {
      fail("OVERVIEW_INVALID", `period ${key} is invalid`);
    }
    if (!(["complete", "partial"].includes(period.coverage)) || !Number.isSafeInteger(period.observation_count) || period.observation_count < 0) fail("OVERVIEW_INVALID", `period ${key} is invalid`);
    let total = 0;
    for (const label of OPTIMICOM_LABELS) {
      if (!Number.isSafeInteger(period.counts?.[label]) || period.counts[label] < 0) fail("OVERVIEW_INVALID", `period ${key} count is invalid`);
      total += period.counts[label];
    }
    if (total !== period.observation_count) fail("OVERVIEW_INVALID", `period ${key} label counts do not sum to observations`);
  }
  return overview;
}

