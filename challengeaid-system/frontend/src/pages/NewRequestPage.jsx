import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PAYMENT_TYPE_LABEL } from '../components/StatusBadge';

export function NewRequestPage() {
  const navigate = useNavigate();
  const [centres, setCentres] = useState([]);
  const [budgetLines, setBudgetLines] = useState([]);
  const [form, setForm] = useState({
    centreId: '',
    scopeType: 'single_center',
    selectedCentreIds: [],
    scopeLabel: '',
    budgetLineId: '',
    activity: '',
    paymentType: 'coach_fee',
    otherPaymentType: '',
    recipientName: '',
    recipientAccount: '',
    recipientPhone: '',
    amount: '',
    justification: '',
    invoiceFileUrl: '',
    quotationFileUrl: ''
  });
  const [allocationLines, setAllocationLines] = useState([
    { lineType: 'centre', centreId: '', clusterName: '', description: '', units: '', unitCost: '', notes: '' }
  ]);
  const [distributions, setDistributions] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.listCentres(), api.listBudgetLines()])
      .then(([centreRows, budgetRows]) => { setCentres(centreRows); setBudgetLines(budgetRows); })
      .catch((err) => setError(err.message));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function readFile(file, field) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update(field, reader.result);
    reader.readAsDataURL(file);
  }

  function updateLine(index, field, value) {
    setAllocationLines((lines) => lines.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  function addLine() {
    setAllocationLines((lines) => [...lines, { lineType: 'centre', centreId: '', clusterName: '', description: '', units: '', unitCost: '', notes: '' }]);
  }

  function removeLine(index) {
    setAllocationLines((lines) => lines.length === 1 ? lines : lines.filter((_, i) => i !== index));
  }

  function updateDistribution(index, field, value) {
    setDistributions((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  function toggleCentre(centreId) {
    setForm((current) => {
      const selected = current.selectedCentreIds.includes(centreId)
        ? current.selectedCentreIds.filter((id) => id !== centreId)
        : [...current.selectedCentreIds, centreId];
      return { ...current, selectedCentreIds: selected, centreId: selected[0] || '' };
    });
  }

  function toggleCluster(centreIds) {
    setForm((current) => {
      const allSelected = centreIds.every((centreId) => current.selectedCentreIds.includes(centreId));
      const selected = allSelected
        ? current.selectedCentreIds.filter((centreId) => !centreIds.includes(centreId))
        : [...new Set([...current.selectedCentreIds, ...centreIds])];
      return { ...current, selectedCentreIds: selected, centreId: selected[0] || '' };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.recipientAccount && !form.recipientPhone) {
      setError('Provide a bank account or a mobile money number for the recipient.');
      return;
    }
    const validLines = allocationLines.filter((line) => line.description && Number(line.units) > 0 && Number(line.unitCost) > 0);
    if (!form.selectedCentreIds.length || !validLines.length) {
      setError('Select at least one SOH center and complete at least one allocation line.');
      return;
    }
    const total = validLines.reduce((sum, line) => sum + Number(line.units) * Number(line.unitCost), 0);

    setBusy(true);
    try {
      const created = await api.createRequest({
        centreId: form.centreId,
        scopeType: form.scopeType,
        scopeLabel: form.scopeLabel || undefined,
        selectedCentreIds: form.selectedCentreIds,
        allocationLines: validLines.map((line) => ({
          lineType: line.lineType,
          centreId: line.lineType === 'centre' ? line.centreId : undefined,
          clusterName: line.clusterName || undefined,
          description: line.description,
          units: Number(line.units),
          unitCost: Number(line.unitCost),
          notes: line.notes || undefined
        })),
        distributions: distributions.filter((row) => row.supervisorName && Number(row.amount) > 0).map((row) => ({
          supervisorName: row.supervisorName,
          centreId: row.centreId || undefined,
          amount: Number(row.amount),
          notes: row.notes || undefined
        })),
        budgetLineId: form.budgetLineId,
        activity: form.activity,
        paymentType: form.paymentType,
        otherPaymentType: form.otherPaymentType || undefined,
        recipientName: form.recipientName,
        recipientAccount: form.recipientAccount || undefined,
        recipientPhone: form.recipientPhone || undefined,
        amount: total,
        justification: form.justification,
        invoiceFileUrl: form.invoiceFileUrl || undefined,
        quotationFileUrl: form.quotationFileUrl || undefined
      });
      navigate(`/requests/${created.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedBudgetLine = budgetLines.find((b) => b.id === form.budgetLineId);
  const budgetGroups = budgetLines.reduce((groups, line) => {
    (groups[line.budget_group] ||= []).push(line);
    return groups;
  }, {});

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-header">
        <h1>New Payment Request</h1>
      </div>

      <form className="card" onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="scopeType">Requisition scope</label>
          <select id="scopeType" value={form.scopeType} onChange={(e) => update('scopeType', e.target.value)}>
            <option value="single_center">Single SOH Center</option>
            <option value="single_cluster">One Cluster</option>
            <option value="multi_cluster">Multiple Clusters</option>
          </select>
        </div>

        <div className="field">
          <label>SOH Centers / Clusters covered</label>
          <div style={{ display: 'grid', gap: '0.35rem', maxHeight: 190, overflowY: 'auto', border: '1px solid var(--line-strong)', padding: '0.6rem' }}>
            {Object.entries(centres.reduce((groups, centre) => { (groups[centre.location] ||= []).push(centre); return groups; }, {})).map(([location, group]) => (
              <ClusterSelection
                key={location}
                location={location}
                centres={group}
                selectedCentreIds={form.selectedCentreIds}
                singleCentre={form.scopeType === 'single_center'}
                onToggleCluster={toggleCluster}
                onToggleCentre={toggleCentre}
                onSelectSingle={(centreId) => setForm((current) => ({ ...current, selectedCentreIds: [centreId], centreId }))}
              />
            ))}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '0.35rem' }}>Select one center for a routine request, or multiple centers for a joint requisition.</p>
        </div>

        <div className="field">
          <label htmlFor="activity">Activity</label>
          <input id="activity" value={form.activity} onChange={(e) => update('activity', e.target.value)} required placeholder="e.g. Youth coaching session" />
        </div>

        <div className="field">
          <label htmlFor="budgetLine">Budget line</label>
          <select
            id="budgetLine"
            value={form.budgetLineId}
            onChange={(e) => update('budgetLineId', e.target.value)}
            required
            disabled={!budgetLines.length}
          >
            <option value="" disabled>Select a budget line…</option>
            {Object.entries(budgetGroups).map(([group, lines]) => (
              <optgroup key={group} label={group}>
                {lines.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.remaining} remaining</option>)}
              </optgroup>
            ))}
          </select>
          {selectedBudgetLine && (
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '0.35rem' }}>
              Allocated {selectedBudgetLine.allocated_amount}, spent {selectedBudgetLine.spent_to_date}
            </p>
          )}
        </div>

        <div className="field">
          <label>Allocation lines</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>Add the activity breakdown. Total is calculated automatically from units and unit cost.</p>
          {allocationLines.map((line, index) => (
            <div key={index} style={{ border: '1px solid var(--line)', padding: '0.75rem', marginBottom: '0.7rem' }}>
              <select value={line.lineType === 'cluster' ? `cluster:${line.clusterName}` : line.lineType === 'shared' ? 'shared' : line.centreId} onChange={(e) => {
                const value = e.target.value;
                if (value === 'shared') updateLine(index, 'lineType', 'shared');
                else if (value.startsWith('cluster:')) { updateLine(index, 'lineType', 'cluster'); updateLine(index, 'clusterName', value.slice(8)); updateLine(index, 'centreId', ''); }
                else { updateLine(index, 'lineType', 'centre'); updateLine(index, 'centreId', value); updateLine(index, 'clusterName', ''); }
              }} required>
                <option value="">Select line center or cluster…</option>
                <option value="shared">Shared / Joint</option>
                {[...new Set(centres.filter((centre) => form.selectedCentreIds.includes(centre.id)).map((centre) => centre.location))].map((cluster) => <option key={cluster} value={`cluster:${cluster}`}>{cluster}</option>)}
                {centres.filter((centre) => form.selectedCentreIds.includes(centre.id)).map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}
              </select>
              <input placeholder="Description" value={line.description} onChange={(e) => updateLine(index, 'description', e.target.value)} required style={{ marginTop: '0.5rem' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input type="number" min="0.01" step="0.01" placeholder="Units" value={line.units} onChange={(e) => updateLine(index, 'units', e.target.value)} required />
                <input type="number" min="0.01" step="0.01" placeholder="Unit cost (KSh)" value={line.unitCost} onChange={(e) => updateLine(index, 'unitCost', e.target.value)} required />
              </div>
              <input placeholder="Notes (optional)" value={line.notes} onChange={(e) => updateLine(index, 'notes', e.target.value)} style={{ marginTop: '0.5rem' }} />
              <p style={{ fontSize: '0.8rem', margin: '0.5rem 0 0' }}>Line total: KSh {(Number(line.units || 0) * Number(line.unitCost || 0)).toLocaleString('en-KE')}</p>
              {allocationLines.length > 1 && <button type="button" onClick={() => removeLine(index)} style={{ marginTop: '0.5rem' }}>Remove line</button>}
            </div>
          ))}
          <button type="button" onClick={addLine}>Add allocation line</button>
          <p style={{ fontWeight: 600 }}>Grand total: KSh {allocationLines.reduce((sum, line) => sum + Number(line.units || 0) * Number(line.unitCost || 0), 0).toLocaleString('en-KE')}</p>
        </div>

        <div className="field">
          <label>Supervisor payment schedule (optional at submission)</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>Use this to record who will be paid under a consolidated cluster line. Finance can verify it before execution.</p>
          {distributions.map((row, index) => (
            <div key={index} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr auto', gap: '0.4rem', marginBottom: '0.5rem' }}>
              <input placeholder="Supervisor name" value={row.supervisorName} onChange={(e) => updateDistribution(index, 'supervisorName', e.target.value)} />
              <select value={row.centreId} onChange={(e) => updateDistribution(index, 'centreId', e.target.value)}><option value="">Centre</option>{centres.filter((centre) => form.selectedCentreIds.includes(centre.id)).map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}</select>
              <input type="number" min="0.01" step="0.01" placeholder="Amount" value={row.amount} onChange={(e) => updateDistribution(index, 'amount', e.target.value)} />
              <button type="button" onClick={() => setDistributions((rows) => rows.filter((_, i) => i !== index))}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => setDistributions((rows) => [...rows, { supervisorName: '', centreId: '', amount: '', notes: '' }])}>Add supervisor</button>
        </div>

        <div className="field">
          <label htmlFor="paymentType">Payment type</label>
          <select id="paymentType" value={form.paymentType} onChange={(e) => update('paymentType', e.target.value)}>
            {Object.entries(PAYMENT_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {form.paymentType === 'other' && (
          <div className="field">
            <label htmlFor="otherPaymentType">Specify payment type</label>
            <input
              id="otherPaymentType"
              value={form.otherPaymentType}
              onChange={(e) => update('otherPaymentType', e.target.value)}
              placeholder="e.g. Transport or venue hire"
              required
            />
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '0.35rem' }}>
              Please describe the payment clearly.
            </p>
          </div>
        )}

        <div className="field">
          <label htmlFor="recipientName">Recipient name</label>
          <input
            id="recipientName"
            value={form.recipientName}
            onChange={(e) => update('recipientName', e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="field">
            <label htmlFor="recipientAccount">Bank account (if applicable)</label>
            <input
              id="recipientAccount"
              value={form.recipientAccount}
              onChange={(e) => update('recipientAccount', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="recipientPhone">Mobile number (if applicable)</label>
            <input
              id="recipientPhone"
              value={form.recipientPhone}
              onChange={(e) => update('recipientPhone', e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="justification">Justification</label>
          <textarea
            id="justification"
            rows={3}
            value={form.justification}
            onChange={(e) => update('justification', e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="invoice">Invoice (optional)</label>
          <input id="invoice" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => readFile(e.target.files[0], 'invoiceFileUrl')} />
        </div>

        <div className="field">
          <label htmlFor="quotation">Quotation (optional)</label>
          <input id="quotation" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => readFile(e.target.files[0], 'quotationFileUrl')} />
        </div>

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
        <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '0.75rem' }}>
          This goes to Finance first, then the Director, then all four Trustees — the sequence is fixed
          regardless of amount.
        </p>
      </form>
    </div>
  );
}

function ClusterSelection({ location, centres, selectedCentreIds, singleCentre, onToggleCluster, onToggleCentre, onSelectSingle }) {
  const selectAllRef = useRef(null);
  const centreIds = centres.map((centre) => centre.id);
  const selectedCount = centreIds.filter((centreId) => selectedCentreIds.includes(centreId)).length;
  const allSelected = selectedCount === centreIds.length;
  const partiallySelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: '0.8rem' }}>{location}</legend>
      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.2rem' }}>
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allSelected}
          disabled={singleCentre}
          onChange={() => onToggleCluster(centreIds)}
        />{' '}
        Select all {location.replace(' Cluster', '')} centers ({centres.length})
      </label>
      {centres.map((centre) => (
        <label key={centre.id} style={{ display: 'block', fontSize: '0.85rem', paddingLeft: '0.8rem' }}>
          <input
            type={singleCentre ? 'radio' : 'checkbox'}
            name="selectedCentre"
            checked={selectedCentreIds.includes(centre.id)}
            onChange={() => singleCentre ? onSelectSingle(centre.id) : onToggleCentre(centre.id)}
          />{' '}
          {centre.name}
        </label>
      ))}
    </fieldset>
  );
}
