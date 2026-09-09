import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, formatAmount, formatDate, PAYMENT_TYPE_LABEL } from '../components/StatusBadge';
import { ApprovalStampRow } from '../components/ApprovalStampRow';

const APPROVER_ROLES = ['finance', 'director', 'trustee'];

const DOC_TYPE_LABEL = {
  signed_payment_form: 'Signed payment form',
  coach_acknowledgement: 'Coach acknowledgement',
  vendor_receipt: 'Vendor receipt / invoice',
  delivery_note: 'Delivery note',
  supervisor_confirmation: 'Supervisor confirmation',
  service_confirmation: 'Service confirmation',
  other_evidence: 'Other evidence'
};

export function RequestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState('');
  const [revision, setRevision] = useState({
    activity: '',
    recipientName: '',
    recipientAccount: '',
    recipientPhone: '',
    amount: '',
    justification: '',
    invoiceFileUrl: '',
    quotationFileUrl: ''
  });

  const load = useCallback(() => {
    setError(null);
    return api.getRequest(id).then(setRequest).catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!request) return;
    setRevision({
      activity: request.activity || '',
      recipientName: request.recipient_name || '',
      recipientAccount: request.recipient_account || '',
      recipientPhone: request.recipient_phone || '',
      amount: request.amount || '',
      justification: request.justification || '',
      invoiceFileUrl: request.invoice_file_url || '',
      quotationFileUrl: request.quotation_file_url || ''
    });
  }, [request]);

  async function handleDecision(decision) {
    if (['rejected', 'more_info_requested'].includes(decision) && !comments.trim()) {
      setError(decision === 'rejected'
        ? 'A rejection needs a reason in the comments field.'
        : 'Explain what must be corrected in the comments field.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decide(id, { decision, comments: comments.trim() || undefined });
      setComments('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateRevision(field, value) {
    setRevision((current) => ({ ...current, [field]: value }));
  }

  function readRevisionFile(file, field) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateRevision(field, reader.result);
    reader.readAsDataURL(file);
  }

  async function handleResubmit(e) {
    e.preventDefault();
    if (!revision.recipientAccount && !revision.recipientPhone) {
      setError('Provide a bank account or a mobile money number for the recipient.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.reviseAndResubmit(id, {
        activity: revision.activity,
        recipientName: revision.recipientName,
        recipientAccount: revision.recipientAccount || undefined,
        recipientPhone: revision.recipientPhone || undefined,
        amount: Number(revision.amount),
        justification: revision.justification,
        invoiceFileUrl: revision.invoiceFileUrl || undefined,
        quotationFileUrl: revision.quotationFileUrl || undefined
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleExecute(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    setBusy(true);
    setError(null);
    try {
      await api.execute(id, {
        method: form.get('method'),
        transactionReference: form.get('transactionReference')
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument(id, {
        documentType: form.get('documentType'),
        fileUrl: form.get('fileUrl')
      });
      e.target.reset();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!request && !error) return <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>;
  if (error && !request) return <div className="error-banner">{error}</div>;

  const canDecide = APPROVER_ROLES.includes(user.role) && isMyTurn(request, user);
  const canRevise = user.role === 'staff' && request.requester_id === user.id && ['rejected', 'more_info_requested'].includes(request.status);
  const canExecute = (user.role === 'finance' || user.role === 'admin') && request.status === 'trustee_approved';
  const canUpload = ['staff', 'finance', 'admin'].includes(user.role) && ['disbursed', 'reconciled'].includes(request.status);

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <div>
          <h1>{request.recipient_name}</h1>
          <p className="eyebrow" style={{ marginTop: '0.25rem' }}>
            {request.payment_type === 'other' ? request.other_payment_type : PAYMENT_TYPE_LABEL[request.payment_type]} · Submitted {formatDate(request.submitted_at)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {error && <div className="error-banner">{error}</div>}

      {request.approvalStatus?.all?.filter((decision) => ['rejected', 'more_info_requested'].includes(decision.decision)).map((decision) => (
        <div key={decision.id} className="error-banner">
          <strong>{decision.decision === 'rejected' ? 'Rejected' : 'More information requested'} by {decision.approver_name}:</strong>{' '}
          {decision.comments}
        </div>
      ))}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="amount">{formatAmount(request.amount)}</span>
        </div>
        <hr className="hairline" />
        <p><strong>Justification:</strong> {request.justification}</p>
        <p><strong>Activity:</strong> {request.activity}</p>
        {request.payment_type === 'other' && <p><strong>Specified payment type:</strong> {request.other_payment_type}</p>}
        {(request.invoice_file_url || request.quotation_file_url) && (
          <p>
            <strong>Supporting documents:</strong>{' '}
            {request.invoice_file_url && <a href={request.invoice_file_url} download="invoice">Invoice</a>}
            {request.invoice_file_url && request.quotation_file_url && ' · '}
            {request.quotation_file_url && <a href={request.quotation_file_url} download="quotation">Quotation</a>}
          </p>
        )}
        <p style={{ marginBottom: 0 }}>
          <strong>Recipient:</strong> {request.recipient_name}
          {request.recipient_account && <> · Account <span className="mono">{request.recipient_account}</span></>}
          {request.recipient_phone && <> · Phone <span className="mono">{request.recipient_phone}</span></>}
        </p>
        {request.rejection_reason && (
          <p style={{ color: 'var(--stamp-brick)', marginTop: '0.75rem' }}>
            <strong>Rejection reason:</strong> {request.rejection_reason}
          </p>
        )}
      </div>

      <h2 style={{ marginTop: '2rem' }}>Approval Chain</h2>
      <ApprovalStampRow approvalStatus={request.approvalStatus} />

      {canDecide && (
        <div className="card">
          <h3>Your decision</h3>
          <div className="field" style={{ marginTop: '0.75rem' }}>
            <label htmlFor="comments">Reason or required corrections (required for rejection and information requests)</label>
            <textarea id="comments" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="stamp-teal" disabled={busy} onClick={() => handleDecision('approved')}>Approve</button>
            <button className="stamp-amber" disabled={busy} onClick={() => handleDecision('more_info_requested')}>Request Info</button>
            <button className="stamp-brick" disabled={busy} onClick={() => handleDecision('rejected')}>Reject</button>
          </div>
        </div>
      )}

      {canRevise && (
        <div className="card">
          <h3>Correct and resubmit</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
            Update the request using the feedback above. It will return to Finance for a fresh review.
          </p>
          <form onSubmit={handleResubmit}>
            <div className="field">
              <label htmlFor="revisionActivity">Activity</label>
              <input id="revisionActivity" value={revision.activity} onChange={(e) => updateRevision('activity', e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="revisionRecipientName">Recipient name</label>
              <input id="revisionRecipientName" value={revision.recipientName} onChange={(e) => updateRevision('recipientName', e.target.value)} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="field">
                <label htmlFor="revisionAccount">Bank account</label>
                <input id="revisionAccount" value={revision.recipientAccount} onChange={(e) => updateRevision('recipientAccount', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="revisionPhone">Mobile number</label>
                <input id="revisionPhone" value={revision.recipientPhone} onChange={(e) => updateRevision('recipientPhone', e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="revisionAmount">Amount (KES)</label>
              <input id="revisionAmount" type="number" min="1" step="1" value={revision.amount} onChange={(e) => updateRevision('amount', e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="revisionJustification">Justification</label>
              <textarea id="revisionJustification" rows={3} value={revision.justification} onChange={(e) => updateRevision('justification', e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="revisionInvoice">Replace invoice (optional)</label>
              <input id="revisionInvoice" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => readRevisionFile(e.target.files[0], 'invoiceFileUrl')} />
            </div>
            <div className="field">
              <label htmlFor="revisionQuotation">Replace quotation (optional)</label>
              <input id="revisionQuotation" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => readRevisionFile(e.target.files[0], 'quotationFileUrl')} />
            </div>
            <button type="submit" className="primary" disabled={busy}>Resubmit for review</button>
          </form>
        </div>
      )}

      {canExecute && (
        <div className="card">
          <h3>Execute payment</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
            All four trustees have signed off. Release the funds via Cooperative Bank, then record the
            confirmation here.
          </p>
          <form onSubmit={handleExecute}>
            <div className="field">
              <label htmlFor="method">Method</label>
              <select id="method" name="method">
                <option value="cooperative_bank_transfer">Cooperative Bank transfer</option>
                <option value="mco_op_cash">M-Co-op Cash</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="transactionReference">Transaction reference</label>
              <input id="transactionReference" name="transactionReference" required />
            </div>
            <button type="submit" className="primary" disabled={busy}>Record payment executed</button>
          </form>
        </div>
      )}

      {canUpload && (
        <div className="card">
          <h3>Reconciliation documents</h3>
          {request.reconciliation && (
            <>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                Required for this payment type: {request.reconciliation.required.map((d) => DOC_TYPE_LABEL[d]).join(', ')}
              </p>
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
                {request.reconciliation.required.map((d) => (
                  <li key={d} style={{ color: request.reconciliation.present.includes(d) ? 'var(--stamp-teal)' : 'var(--ink-soft)' }}>
                    {request.reconciliation.present.includes(d) ? '✓ ' : '○ '}{DOC_TYPE_LABEL[d]}
                  </li>
                ))}
              </ul>
            </>
          )}
          <form onSubmit={handleUpload}>
            <div className="field">
              <label htmlFor="documentType">Document type</label>
              <select id="documentType" name="documentType">
                {Object.entries(DOC_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fileUrl">File reference (URL or path)</label>
              <input id="fileUrl" name="fileUrl" placeholder="e.g. https://…/receipt.pdf" required />
            </div>
            <button type="submit" disabled={busy}>Attach document</button>
          </form>
        </div>
      )}
    </div>
  );
}

// A given approver role can act only when it's their stage's turn —
// mirrors the backend's assertStageIsUnlocked so the UI doesn't offer
// a button that the API would reject anyway.
function isMyTurn(request, user) {
  const status = request.status;
  if (user.role === 'finance') return ['submitted', 'more_info_requested'].includes(status);
  if (user.role === 'director') return status === 'finance_approved';
  if (user.role === 'trustee') {
    if (status !== 'director_approved') return false;
    const already = (request.approvalStatus?.trusteeApprovals || []).some((t) => t.approver_id === user.id);
    return !already;
  }
  return false;
}
