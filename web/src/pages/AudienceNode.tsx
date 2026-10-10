import { TopBar } from '../ui/components.tsx';

export function AudienceNode({ code }: { code: string }) {
  return (
    <div className="shell">
      <TopBar title={`Audience camera · ${code}`} />
      <main id="main" className="panel empty">Audience camera arrives in M2.</main>
    </div>
  );
}
