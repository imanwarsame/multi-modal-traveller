import { formatCost, formatDistance, formatDuration } from '../lib/geo';
import type { Itinerary, Leg } from '../types';

export const MODE_ICON: Record<string, string> = {
  walk: '🚶',
  cycle: '🚲',
  drive: '🚗',
  bus: '🚌',
  metro: '🚇',
  rail: '🚆',
};

export function legIcon(leg: Leg): string {
  return MODE_ICON[leg.mode === 'transit' ? leg.transitKind! : leg.mode];
}

interface Props {
  itinerary: Itinerary;
  selected: boolean;
  rank: number;
  onSelect: () => void;
}

export function ItineraryCard({ itinerary, selected, rank, onSelect }: Props) {
  return (
    <button type="button" className={`itinerary-card${selected ? ' selected' : ''}`} onClick={onSelect}>
      <div className="card-head">
        <span className="card-label">
          {rank === 0 && <span className="badge">Best</span>}
          {itinerary.label}
        </span>
        <span className="card-time">{formatDuration(itinerary.totalDurationS)}</span>
      </div>
      <div className="card-legs">
        {itinerary.legs.map((leg, i) => (
          <span className="card-leg" key={i}>
            {i > 0 && <span className="leg-arrow">›</span>}
            <span className={`leg-chip mode-${leg.mode}`}>
              {legIcon(leg)} {formatDuration(leg.durationS)}
            </span>
          </span>
        ))}
      </div>
      <div className="card-foot">
        <span>{formatCost(itinerary.totalCost)}</span>
        <span>{formatDistance(itinerary.legs.reduce((s, l) => s + l.distanceM, 0))}</span>
      </div>
      {selected && (
        <div className="card-detail">
          <ol className="leg-steps">
            {itinerary.legs.map((leg, i) => (
              <li key={i}>
                <span className="leg-step-icon">{legIcon(leg)}</span>
                <span>
                  {leg.mode === 'transit' ? 'Ride' : leg.mode === 'drive' ? 'Drive' : leg.mode === 'cycle' ? 'Cycle' : 'Walk'}{' '}
                  to <strong>{leg.to.name}</strong>
                  <small>
                    {formatDistance(leg.distanceM)} · {formatDuration(leg.durationS)}
                    {leg.cost > 0 ? ` · ${formatCost(leg.cost)}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ol>
          {itinerary.notes.map((note, i) => (
            <p className="note" key={i}>ⓘ {note}</p>
          ))}
        </div>
      )}
    </button>
  );
}
