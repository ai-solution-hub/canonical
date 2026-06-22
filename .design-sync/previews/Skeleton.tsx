import { Skeleton } from 'canonical';

// Skeleton sizing via inline styles (the component supplies the pulse + token bg).
export function CardLoading() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: 320,
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton style={{ height: 40, width: 40, borderRadius: 999 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton style={{ height: 12, width: 160 }} />
          <Skeleton style={{ height: 10, width: 100 }} />
        </div>
      </div>
      <Skeleton style={{ height: 10, width: '100%' }} />
      <Skeleton style={{ height: 10, width: '85%' }} />
      <Skeleton style={{ height: 10, width: '60%' }} />
    </div>
  );
}
