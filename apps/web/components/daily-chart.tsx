type Day = { day: string; widget: number; dashboard: number };

const shortDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Questions per day, stacked by channel. Plain SVG: no chart library needed for one bar chart. */
export function DailyChart({ days }: { days: Day[] }) {
  const max = Math.max(1, ...days.map((d) => d.widget + d.dashboard));
  const W = 600;
  const H = 140;
  const gap = days.length > 31 ? 1 : 3;
  const barW = (W - gap * (days.length - 1)) / days.length;
  const total = days.reduce((s, d) => s + d.widget + d.dashboard, 0);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${total} questions over ${days.length} days`} preserveAspectRatio="none">
        {days.map((d, i) => {
          const x = i * (barW + gap);
          const hDash = (d.dashboard / max) * (H - 4);
          const hWidget = (d.widget / max) * (H - 4);
          return (
            <g key={d.day}>
              <title>{`${shortDate(d.day)}: ${d.widget} from the website widget, ${d.dashboard} from the dashboard`}</title>
              <rect x={x} y={H - hDash} width={barW} height={hDash} className="bar-dashboard" rx={1.5} />
              <rect x={x} y={H - hDash - hWidget} width={barW} height={hWidget} className="bar-widget" rx={1.5} />
              {/* invisible full-height target so the tooltip works on empty days too */}
              <rect x={x} y={0} width={barW} height={H} fill="transparent" />
            </g>
          );
        })}
      </svg>
      <figcaption className="chart-axis">
        <span>{days[0] && shortDate(days[0].day)}</span>
        <span className="legend">
          <i className="swatch bar-widget" /> Website widget <i className="swatch bar-dashboard" /> Dashboard
        </span>
        <span>{days.at(-1) && shortDate(days.at(-1)!.day)}</span>
      </figcaption>
    </figure>
  );
}
