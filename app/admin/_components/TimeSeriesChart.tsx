'use client';
/**
 * SVG 折れ線グラフ（依存ゼロ）。
 *  - 複数系列を1つの SVG に重ねる。
 *  - viewBox を使うのでレスポンシブに伸縮する。
 *  - 軸ラベル（日付 / 縦軸数値）＋ 薄いグリッド線。
 *  - 全点 0 でも線が描画されるよう、minMax を [0,1] にフォールバック。
 */
import type { CSSProperties } from 'react';

export interface ChartPoint {
  date: string;
  value: number;
}
export interface ChartSeries {
  name: string;
  color: string;
  points: ChartPoint[];
}

export interface TimeSeriesChartProps {
  series: ChartSeries[];
  height?: number;
  width?: number;
  style?: CSSProperties;
}

const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

export default function TimeSeriesChart({
  series,
  height = 240,
  width = 720,
  style,
}: TimeSeriesChartProps) {
  // X 軸ラベルは最初の系列の date 列を採用（API 側で全系列同一長を保証している）。
  const labels = series[0]?.points.map((p) => p.date) ?? [];
  const n = labels.length;

  if (n === 0) {
    return (
      <div style={{ color: '#666', fontSize: 13, ...style }}>データがありません。</div>
    );
  }

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const rawMax = Math.max(...allValues, 0);
  const yMax = rawMax > 0 ? niceCeil(rawMax) : 1;

  const innerW = width - PAD_LEFT - PAD_RIGHT;
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const xAt = (i: number) => PAD_LEFT + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (v: number) => PAD_TOP + innerH - (innerH * v) / yMax;

  // Y 軸グリッド（5分割）
  const ySteps = 5;
  const gridYs: number[] = [];
  for (let i = 0; i <= ySteps; i++) gridYs.push((yMax * i) / ySteps);

  // X 軸ラベルは多すぎるとつぶれるので最大 ~8 個に間引き。
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <div style={{ width: '100%', ...style }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={series.map((s) => s.name).join(' / ') + ' 時系列グラフ'}
      >
        {/* グリッド */}
        {gridYs.map((v, i) => {
          const y = yAt(v);
          return (
            <g key={`grid-${i}`}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={width - PAD_RIGHT}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 4}
                fontSize={10}
                fill="#6b7280"
                textAnchor="end"
              >
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {/* X 軸ラベル */}
        {labels.map((d, i) => {
          if (i % labelStep !== 0 && i !== n - 1) return null;
          const x = xAt(i);
          return (
            <text
              key={`xl-${i}`}
              x={x}
              y={height - 10}
              fontSize={10}
              fill="#6b7280"
              textAnchor="middle"
            >
              {d.slice(5)}
            </text>
          );
        })}

        {/* 折れ線 */}
        {series.map((s) => {
          const d = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`)
            .join(' ');
          return (
            <g key={s.name}>
              <path d={d} stroke={s.color} strokeWidth={2} fill="none" />
              {s.points.map((p, i) => (
                <circle
                  key={`${s.name}-pt-${i}`}
                  cx={xAt(i)}
                  cy={yAt(p.value)}
                  r={2.5}
                  fill={s.color}
                >
                  <title>{`${s.name} ${p.date}: ${p.value}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* 軸の枠線 */}
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP}
          x2={PAD_LEFT}
          y2={PAD_TOP + innerH}
          stroke="#9ca3af"
          strokeWidth={1}
        />
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP + innerH}
          x2={width - PAD_RIGHT}
          y2={PAD_TOP + innerH}
          stroke="#9ca3af"
          strokeWidth={1}
        />
      </svg>

      {/* 凡例 */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#374151', marginTop: 4 }}>
        {series.map((s) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                background: s.color,
                borderRadius: 2,
              }}
            />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 軸上限を「いい感じの数値」に切り上げる（1,2,5×10^n の刻み）。 */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  let nice: number;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}
