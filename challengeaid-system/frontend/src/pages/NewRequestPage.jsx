import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PAYMENT_TYPE_LABEL } from '../components/StatusBadge';

export function NewRequestPage() {
  const navigate = useNavigate();
  const [centres, setCentres] = useState([]);
  const [budgetLines, setBudgetLines] = useState([]);
  const [form, setForm] = useState({
    centreId: '',
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.recipientAccount && !form.recipientPhone) {
      setError('Provide a bank account or a mobile money number for the recipient.');
      return;
    }

    setBusy(true);
    try {
      const created = await api.createRequest({
        centreId: form.centreId,
        budgetLineId: form.budgetLineId,
        activity: form.activity,
        paymentType: form.paymentType,
        otherPaymentType: form.otherPaymentType || undefined,
        recipientName: form.recipientName,
        recipientAccount: form.recipientAccount || undefined,
        recipientPhone: form.recipientPhone || undefined,
        amount: Number(form.amount),
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
          <label htmlFor="centre">SOH Center</label>
          <select id="centre" value={form.centreId} onChange={(e) => update('centreId', e.target.value)} required>
            <option value="" disabled>Select an SOH center…</option>
            {Object.entries(centres.reduce((groups, centre) => {
              (groups[centre.location] ||= []).push(centre);
              return groups;
            }, {})).map(([location, group]) => (
              <optgroup key={location} label={location}>
                {group.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}
              </optgroup>
            ))}
          </select>
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
          <label htmlFor="amount">Amount (KES)</label>
          <input
            id="amount"
            type="number"
            min="1"
            step="1"
            value={form.amount}
            onChange={(e) => update('amount', e.target.value)}
            required
          />
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
