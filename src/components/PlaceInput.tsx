import { useEffect, useRef, useState } from 'react';
import { geocode, type GeocodeResult } from '../lib/mapboxApi';
import type { LngLat, Place } from '../types';

interface Props {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  proximity?: LngLat;
  allowMyLocation?: boolean;
}

export function PlaceInput({ label, placeholder, value, onChange, proximity, allowMyLocation }: Props) {
  const [text, setText] = useState(value?.name ?? '');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const debounce = useRef<number>();
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value?.name ?? '');
  }, [value]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  function handleInput(next: string) {
    setText(next);
    onChange(null);
    window.clearTimeout(debounce.current);
    if (next.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounce.current = window.setTimeout(async () => {
      try {
        const results = await geocode(next, proximity);
        setSuggestions(results);
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  }

  function pick(s: GeocodeResult) {
    onChange({ name: s.name, coord: s.coord });
    setText(s.name);
    setOpen(false);
  }

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ name: 'My location', coord: [pos.coords.longitude, pos.coords.latitude] });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="place-input" ref={wrapper}>
      <label>
        <span className="place-input-label">{label}</span>
        <div className="place-input-row">
          <input
            type="text"
            value={text}
            placeholder={placeholder}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            autoComplete="off"
          />
          {allowMyLocation && (
            <button
              type="button"
              className="locate-btn"
              title="Use my location"
              onClick={useMyLocation}
              disabled={locating}
            >
              {locating ? '…' : '◎'}
            </button>
          )}
        </div>
      </label>
      {open && suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => pick(s)}>
                <strong>{s.name}</strong>
                <small>{s.context}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
