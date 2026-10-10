import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PresenterNode } from './PresenterNode.tsx';
import { AudienceNode } from './AudienceNode.tsx';
import { TopBar } from '../ui/components.tsx';

/** /camera?role=presenter|audience&s=CODE */
export default function Camera() {
  const [params] = useSearchParams();
  const role = params.get('role') === 'audience' ? 'audience' : 'presenter';
  const code = params.get('s')?.toUpperCase() ?? null;
  if (!code) return <CodeEntry role={role} />;
  return role === 'presenter' ? <PresenterNode code={code} /> : <AudienceNode code={code} />;
}

function CodeEntry({ role }: { role: string }) {
  const [code, setCode] = useState('');
  const nav = useNavigate();
  return (
    <div className="shell">
      <TopBar title={`${role} camera`} />
      <main id="main" className="panel" style={{ maxWidth: 480 }}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) nav(`/camera?role=${role}&s=${code.trim().toUpperCase()}`);
          }}
        >
          <h1>Enter room code</h1>
          <label className="field">
            Room code (shown on the dashboard)
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" maxLength={8} autoFocus />
          </label>
          <button className="btn btn-primary" type="submit">
            Connect {role} camera
          </button>
        </form>
      </main>
    </div>
  );
}
