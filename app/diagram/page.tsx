
'use client';
import { useState } from 'react';

export default function DiagramPage() {
  const [code, setCode] = useState('graph TD; A-->B; A-->C; B-->D; C-->D;');
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const renderPNG = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/api/render-mermaid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, theme: 'default', scale: 2, transparent: false }),
      });
      if (!res.ok) throw new Error('Render failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setImgUrl(url);
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>Mermaid Renderer</h1>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={8}
        style={{ width: '100%', fontFamily: 'monospace' }}
      />
      <div style={{ marginTop: 12 }}>
        <button onClick={renderPNG} disabled={loading}>
          {loading ? 'Rendering...' : 'Render PNG'}
        </button>
      </div>
      {err && <p style={{ color: 'crimson' }}>{err}</p>}
      {imgUrl && (
        <div style={{ marginTop: 16 }}>
          <img src={imgUrl} alt="Mermaid Diagram" />
        </div>
      )}
    </div>
  );
}
