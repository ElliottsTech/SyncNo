// Shared date-range column filter for list routes.
//
// Reads filter_<col>_from / filter_<col>_to (YYYY-MM-DD, inclusive bounds) from
// the request query and appends conditions to the WHERE builder. date() on both
// sides normalizes values that carry time components ("2026-09-29T10:00:00Z" →
// "2026-09-29") so bounds compare correctly; NULL/empty cell values fall out of
// the comparison automatically (filtered rows out when a range is active).
export function addDateRange(conditions, params, query, col) {
  const from = query[`filter_${col}_from`];
  const to = query[`filter_${col}_to`];
  if (from) {
    conditions.push(`date(${col}) >= date(?)`);
    params.push(String(from));
  }
  if (to) {
    conditions.push(`date(${col}) <= date(?)`);
    params.push(String(to));
  }
}
