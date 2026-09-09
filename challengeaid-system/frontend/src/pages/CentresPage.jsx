import { useEffect, useState } from 'react';
import { api } from '../api';

export function CentresPage() {
  const [centres, setCentres] = useState([]);
  const [form, setForm] = useState({ name: '', location: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.listCentres().then(setCentres).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  const groupedCentres = centres.reduce((groups, centre) => {
    (groups[centre.location] ||= []).push(centre);
    return groups;
  }, {});

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCentre(form);
      setForm({ name: '', location: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header"><h1>SOH Centers</h1></div>
      {error && <div className="error-banner">{error}</div>}

      {Object.entries(groupedCentres).map(([location, group]) => (
        <section key={location} style={{ marginBottom: '1.5rem' }}>
          <h2>{location}</h2>
          {group.map((c) => (
            <div key={c.id} className="request-row">
              <div className="request-row-main">
                <div className="recipient">{c.name}</div>
              </div>
            </div>
          ))}
        </section>
      ))}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Add an SOH center</h3>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="field">
            <label htmlFor="location">Location</label>
            <input id="location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} required />
          </div>
          <button type="submit" className="primary" disabled={busy}>Add centre</button>
        </form>
      </div>
    </div>
  );
}
