import { useState } from 'react';
import { ItineraryCard } from './components/ItineraryCard';
import { MapView } from './components/MapView';
import { PlaceInput } from './components/PlaceInput';
import { TokenGate } from './components/TokenGate';
import { getToken } from './lib/mapboxApi';
import { planItineraries } from './lib/planner';
import type { Itinerary, Optimize, Place, TravelMode } from './types';

const ALL_MODES: { id: TravelMode; icon: string; label: string }[] = [
  { id: 'walk', icon: '🚶', label: 'Walk' },
  { id: 'cycle', icon: '🚲', label: 'Bike' },
  { id: 'drive', icon: '🚗', label: 'Car' },
  { id: 'bus', icon: '🚌', label: 'Bus' },
  { id: 'metro', icon: '🚇', label: 'Tube' },
  { id: 'rail', icon: '🚆', label: 'Train' },
];

export default function App() {
  const [hasToken, setHasToken] = useState(() => getToken() !== '');
  const [origin, setOrigin] = useState<Place | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [modes, setModes] = useState<Set<TravelMode>>(() => new Set(ALL_MODES.map((m) => m.id)));
  const [optimize, setOptimize] = useState<Optimize>('fastest');
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);

  if (!hasToken) return <TokenGate onSaved={() => setHasToken(true)} />;

  async function plan() {
    if (!origin || !dest || loading) return;
    setLoading(true);
    setError(null);
    setItineraries([]);
    try {
      const results = await planItineraries(origin, dest, { modes: [...modes], optimize });
      setItineraries(results);
      setSelectedId(results[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const panel = (
    <>
      <header className="panel-header">
        <h1>🧭 Waypoint</h1>
        <p>Mix cycling, driving, and transit to get there faster or cheaper.</p>
      </header>

      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void plan();
        }}
      >
        <PlaceInput
          label="From"
          placeholder="Home, an address, a station…"
          value={origin}
          onChange={setOrigin}
          proximity={dest?.coord}
          allowMyLocation
        />
        <PlaceInput
          label="To"
          placeholder="Where are you headed?"
          value={dest}
          onChange={setDest}
          proximity={origin?.coord}
        />

        <fieldset className="modes">
          <legend>Travel modes — tap to exclude any</legend>
          {ALL_MODES.map((m) => (
            <label key={m.id} className={`mode-toggle${modes.has(m.id) ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={modes.has(m.id)}
                onChange={(e) => {
                  const next = new Set(modes);
                  if (e.target.checked) next.add(m.id);
                  else next.delete(m.id);
                  setModes(next);
                }}
              />
              {m.icon} {m.label}
            </label>
          ))}
          <p className="modes-hint">Short connecting walks are always included.</p>
        </fieldset>

        <fieldset className="optimize">
          <legend>Optimise for</legend>
          <div className="segmented">
            {(['fastest', 'cheapest'] as const).map((opt) => (
              <label key={opt} className={optimize === opt ? 'on' : ''}>
                <input
                  type="radio"
                  name="optimize"
                  checked={optimize === opt}
                  onChange={() => setOptimize(opt)}
                />
                {opt === 'fastest' ? '⚡ Fastest' : '💰 Cheapest'}
              </label>
            ))}
          </div>
        </fieldset>

        <button type="submit" className="plan-btn" disabled={!origin || !dest || modes.size === 0 || loading}>
          {loading ? 'Planning…' : modes.size === 0 ? 'Enable a travel mode' : 'Plan my trip'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {itineraries.length > 0 && (
        <section className="results">
          <h2>
            {itineraries.length} option{itineraries.length > 1 ? 's' : ''} ·{' '}
            {optimize === 'fastest' ? 'fastest first' : 'cheapest first'}
          </h2>
          {itineraries.map((it, i) => (
            <ItineraryCard
              key={it.id}
              itinerary={it}
              rank={i}
              selected={it.id === selectedId}
              onSelect={() => {
                setSelectedId(it.id);
                setSheetOpen(true);
              }}
            />
          ))}
        </section>
      )}
    </>
  );

  return (
    <div className="app">
      <aside className={`panel${sheetOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'}
          onClick={() => setSheetOpen(!sheetOpen)}
        >
          <span />
        </button>
        <div className="panel-scroll">{panel}</div>
      </aside>
      <main className="map-wrap">
        <MapView
          origin={origin}
          dest={dest}
          itineraries={itineraries}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setSheetOpen(true);
          }}
        />
      </main>
    </div>
  );
}
