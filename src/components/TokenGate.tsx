import { useState } from 'react';
import { saveToken } from '../lib/mapboxApi';

export function TokenGate({ onSaved }: { onSaved: () => void }) {
  const [token, setToken] = useState('');
  const valid = token.trim().startsWith('pk.');

  return (
    <div className="token-gate">
      <div className="token-card">
        <h1>🧭 Waypoint</h1>
        <p>
          This app needs a <strong>Mapbox public access token</strong> to search places and
          calculate routes. Create a free one at{' '}
          <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer">
            account.mapbox.com/access-tokens
          </a>{' '}
          and paste it below. It is stored only in your browser.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            saveToken(token);
            onSaved();
          }}
        >
          <input
            type="text"
            placeholder="pk.eyJ1Ijoi..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!valid}>
            Start planning
          </button>
        </form>
        <p className="hint">
          Tip: set <code>VITE_MAPBOX_TOKEN</code> in a <code>.env</code> file to skip this screen.
        </p>
      </div>
    </div>
  );
}
