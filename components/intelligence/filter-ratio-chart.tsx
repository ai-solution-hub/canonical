'use client';

import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { TrendDataPoint } from '@/hooks/intelligence/use-metrics-trend';

interface FilterRatioChartProps {
  data: TrendDataPoint[];
  granularity: 'daily' | 'weekly';
  height?: number;
  className?: string;
}

const PADDING = { top: 20, right: 20, bottom: 40, left: 45 };
const Y_TICKS = [0, 25, 50, 75, 100];

/** Format a YYYY-MM-DD date as DD/MM for daily or "W{nn}" for weekly */
function formatXLabel(
  dateStr: string,
  granularity: 'daily' | 'weekly',
): string {
  if (granularity === 'weekly') {
    const d = new Date(dateStr);
    const start = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(
      ((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7,
    );
    return `W${String(weekNum).padStart(2, '0')}`;
  }
  // DD/MM format (UK English)
  const parts = dateStr.split('-');
  return `${parts[2]}/${parts[1]}`;
}

export function FilterRatioChart({
  data,
  granularity,
  height = 200,
  className,
}: FilterRatioChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || data.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const chartWidth = rect.width - PADDING.left - PADDING.right;
      const relX = x - PADDING.left;
      if (relX < 0 || relX > chartWidth) {
        setHoveredIndex(null);
        return;
      }
      const step =
        data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
      const idx = Math.round(relX / step);
      setHoveredIndex(Math.max(0, Math.min(data.length - 1, idx)));
    },
    [data],
  );

  const handleMouseLeave = useCallback(() => setHoveredIndex(null), []);

  if (data.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-card p-8',
          className,
        )}
        style={{ minHeight: height }}
      >
        <p className="text-sm text-muted-foreground">
          No trend data available yet.
        </p>
      </div>
    );
  }

  // Chart dimensions use a viewBox so SVG scales responsively
  const viewWidth = 600;
  const viewHeight = height;
  const chartWidth = viewWidth - PADDING.left - PADDING.right;
  const chartHeight = viewHeight - PADDING.top - PADDING.bottom;

  // X positions: evenly spaced across chart width
  const xStep = data.length > 1 ? chartWidth / (data.length - 1) : 0;
  const points = data.map((d, i) => ({
    x: PADDING.left + i * xStep,
    y: PADDING.top + chartHeight - (d.ratio / 100) * chartHeight,
    ...d,
  }));

  // Build polyline and polygon paths
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPoints = [
    `${PADDING.left},${PADDING.top + chartHeight}`,
    ...points.map((p) => `${p.x},${p.y}`),
    `${points[points.length - 1].x},${PADDING.top + chartHeight}`,
  ].join(' ');

  // Decide how many x-labels to show (avoid overlap)
  const maxLabels = Math.floor(chartWidth / 50);
  const labelStep = Math.max(1, Math.ceil(data.length / maxLabels));

  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;

  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-sm', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Filter ratio trend chart showing ${data.length} data points from ${formatXLabel(data[0].date, granularity)} to ${formatXLabel(data[data.length - 1].date, granularity)}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Gridlines */}
        {Y_TICKS.map((tick) => {
          const y = PADDING.top + chartHeight - (tick / 100) * chartHeight;
          return (
            <g key={tick}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + chartWidth}
                y2={y}
                className="stroke-border"
                strokeDasharray={tick === 0 || tick === 100 ? undefined : '4 4'}
                strokeWidth={0.5}
              />
              <text
                x={PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <polygon
          points={areaPoints}
          className="fill-[var(--chart-1)]"
          opacity={0.15}
        />

        {/* Line */}
        <polyline
          points={linePoints}
          fill="none"
          className="stroke-[var(--chart-1)]"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data point dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoveredIndex === i ? 4 : 2.5}
            className="fill-[var(--chart-1)]"
          />
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => {
          if (i % labelStep !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={i}
              x={PADDING.left + i * xStep}
              y={viewHeight - 5}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {formatXLabel(d.date, granularity)}
            </text>
          );
        })}

        {/* Hover indicator line */}
        {hoveredPoint && (
          <line
            x1={hoveredPoint.x}
            y1={PADDING.top}
            x2={hoveredPoint.x}
            y2={PADDING.top + chartHeight}
            className="stroke-muted-foreground"
            strokeWidth={0.5}
            strokeDasharray="4 4"
          />
        )}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && (
        <div className="mt-2 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
          <p className="font-medium">
            {formatXLabel(hoveredPoint.date, granularity)}
          </p>
          <p>
            Pass rate:{' '}
            <span className="font-semibold">{hoveredPoint.ratio}%</span>
          </p>
          <p>
            Total: {hoveredPoint.total} | Passed: {hoveredPoint.passed} |
            Filtered: {hoveredPoint.filtered}
          </p>
        </div>
      )}

      {/* Accessible hidden table for screen readers */}
      <table className="sr-only">
        <caption>Filter ratio trend data</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Total articles</th>
            <th scope="col">Passed</th>
            <th scope="col">Filtered</th>
            <th scope="col">Pass rate</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{formatXLabel(d.date, granularity)}</td>
              <td>{d.total}</td>
              <td>{d.passed}</td>
              <td>{d.filtered}</td>
              <td>{d.ratio}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
