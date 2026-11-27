import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {z} from 'zod';

const label = z.string().trim().min(1).max(22);
export const diagramSchema = z.object({
  heading: z.string().trim().min(1).max(48),
  layout: z.enum(['pipeline', 'fan-out', 'fan-in']),
  labels: z.array(label).length(3),
});
export type Diagram = z.infer<typeof diagramSchema>;

export function DiagramClip({heading, layout, labels}: Diagram) {
  const frame = useCurrentFrame();
  const progress = (frame % 90) / 90;
  const points =
    layout === 'pipeline'
      ? [
          [360, 345],
          [360, 565],
          [360, 785],
        ]
      : layout === 'fan-out'
        ? [
            [360, 365],
            [187, 685],
            [533, 685],
          ]
        : [
            [187, 365],
            [533, 365],
            [360, 685],
          ];
  const edges =
    layout === 'pipeline'
      ? [
          [0, 1],
          [1, 2],
        ]
      : layout === 'fan-out'
        ? [
            [0, 1],
            [0, 2],
          ]
        : [
            [0, 2],
            [1, 2],
          ];
  const colors = ['#c9fb83', '#8ddde9', '#cfb6ff'];
  return (
    <AbsoluteFill
      style={{background: '#10151c', color: '#f5f7fa', fontFamily: 'Helvetica Neue, Arial, sans-serif'}}
    >
      <div
        style={{
          position: 'absolute',
          left: 52,
          right: 52,
          top: 94,
          fontWeight: 750,
          fontSize: 52,
          lineHeight: 1.08,
          letterSpacing: -2,
        }}
      >
        {heading}
      </div>
      <svg width="100%" height="100%" viewBox="0 0 720 1280" role="img" aria-label={heading}>
        <title>{heading}</title>
        {edges.map(([from, to], i) => {
          const [x, y] = points[from];
          const [endX, endY] = points[to];
          const t = layout === 'pipeline' ? Math.min(1, Math.max(0, 2 * progress - i)) : progress;
          return (
            <g key={`${from}-${to}`}>
              <line
                x1={x}
                y1={y}
                x2={endX}
                y2={endY}
                stroke="#495866"
                strokeWidth="4"
                strokeDasharray="7 9"
              />
              <circle cx={x + (endX - x) * t} cy={y + (endY - y) * t} r="13" fill={colors[to]} />
            </g>
          );
        })}
        {points.map(([x, y], i) => (
          <g key={colors[i]} transform={`translate(${x} ${y})`}>
            <rect
              x="-145"
              y="-45"
              width="290"
              height="90"
              rx={i === 0 ? 44 : 16}
              fill="#202a35"
              stroke={colors[i]}
              strokeWidth="4"
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(34, 435 / labels[i].length)}
              fill={colors[i]}
              fontWeight="650"
            >
              {labels[i]}
            </text>
          </g>
        ))}
      </svg>
    </AbsoluteFill>
  );
}
