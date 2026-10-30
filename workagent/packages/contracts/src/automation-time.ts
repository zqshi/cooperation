/** Resolve a wall minute to exactly one instant. DST gaps and folds are rejected
 * instead of silently shifting a one-off appointment or choosing a duplicate hour. */
export function automationWallTime(
  isoMinute: string,
  timezone: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(isoMinute))
    throw new Error("请选择完整日期和时间");
  const base = Date.parse(isoMinute + ":00Z");
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const wall = (time: number) => {
    const p = Object.fromEntries(
      fmt.formatToParts(time).map((p) => [p.type, p.value]),
    );
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  const matches = new Set<number>();
  // IANA offsets include quarter/half hours. Sample adjacent dates to include
  // both sides of a timezone transition without depending on host timezone.
  for (let h = -48; h <= 48; h += 6) {
    const sample = base + h * 3600000;
    const offset = Date.parse(wall(sample) + ":00Z") - sample;
    const candidate = base - offset;
    if (wall(candidate) === isoMinute) matches.add(candidate);
  }
  if (matches.size !== 1)
    throw new Error("该本地时刻不存在或因夏令时重复，请选择其他时刻");
  return new Date([...matches][0]!).toISOString();
}
export function automationWallMinute(
  instant: string,
  timezone: string,
): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
