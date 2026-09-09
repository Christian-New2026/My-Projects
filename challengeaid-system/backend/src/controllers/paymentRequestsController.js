const { z } = require('zod');
const db = require('../config/db');
const { query, withTransaction } = db;
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/auditLog');
const { assertBudgetAvailable } = require('../services/budgetService');
const { getApprovalStatus } = require('../services/approvalService');
const { computeReconciliationStatus } = require('../services/reconciliationService');

const createSchema = z
  .object({
    centreId: z.string().uuid(),
    budgetLineId: z.string().uuid(),
    activity: z.string().min(1),
    paymentType: z.enum(['coach_fee', 'foodstuffs', 'supplies', 'cleaning', 'other']),
    recipientName: z.string().min(1),
    recipientAccount: z.string().min(1).optional(),
    recipientPhone: z.string().min(1).optional(),
    amount: z.number().positive(),
    justification: z.string().min(1),
    invoiceFileUrl: z.string().min(1).optional(),
    quotationFileUrl: z.string().min(1).optional()
  })
  .refine((v) => v.recipientAccount || v.recipientPhone, {
    message: 'Provide at least one of recipientAccount or recipientPhone'
  })
  .refine((v) => v.paymentType !== 'other' || v.otherPaymentType, {
    message: 'Specify the payment type when Other is selected',
    path: ['otherPaymentType']
  });

const reviseSchema = z
  .object({
    activity: z.string().min(1),
    recipientName: z.string().min(1),
    recipientAccount: z.string().min(1).optional(),
    recipientPhone: z.string().min(1).optional(),
    amount: z.number().positive(),
    justification: z.string().min(1),
    invoiceFileUrl: z.string().min(1).optional(),
    quotationFileUrl: z.string().min(1).optional()
  })
  .refine((v) => v.recipientAccount || v.recipientPhone, {
    message: 'Provide at least one of recipientAccount or recipientPhone'
  });

// Only 'submitted' onward is visible to approvers; a request in
// 'draft' is the requester's own workspace until they submit it.
async function createRequest(req, res, next) {
  try {
    const input = createSchema.parse(req.body);

    await withTransaction(async (client) => {
      await assertBudgetAvailable(client, { budgetLineId: input.budgetLineId, amount: input.amount });

      const { rows } = await client.query(
        `INSERT INTO payment_requests
            (requester_id, centre_id, budget_line_id, activity, payment_type, other_payment_type,
            recipient_name, recipient_account, recipient_phone, amount, justification,
            invoice_file_url, quotation_file_url, status, submitted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'submitted', now())
         RETURNING *`,
        [
          req.user.id,
          input.centreId,
          input.budgetLineId,
          input.activity,
          input.paymentType,
          input.otherPaymentType || null,
          input.recipientName,
          input.recipientAccount || null,
          input.recipientPhone || null,
          input.amount,
          input.justification,
          input.invoiceFileUrl || null,
          input.quotationFileUrl || null
        ]
      );

      await recordAudit(client, {
        requestId: rows[0].id,
        actorId: req.user.id,
        action: 'request.submitted',
        details: { amount: input.amount, paymentType: input.paymentType }
      });

      res.status(201).json(rows[0]);
    });
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid request payload', 400, err.errors));
    next(err);
  }
}

async function reviseAndResubmit(req, res, next) {
  try {
    const input = reviseSchema.parse(req.body);
    const { id } = req.params;

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE',
        [id]
      );
      const request = rows[0];
      if (!request) throw new AppError('Payment request not found', 404);
      if (request.requester_id !== req.user.id) {
        throw new AppError('Only the original requester can revise this request', 403);
      }
      if (!['rejected', 'more_info_requested'].includes(request.status)) {
        throw new AppError('Only rejected or returned requests can be revised', 409);
      }

      await assertBudgetAvailable(client, {
        budgetLineId: request.budget_line_id,
        amount: input.amount,
        excludeRequestId: id
      });

      await client.query(
        `UPDATE payment_requests
         SET activity = $1, recipient_name = $2, recipient_account = $3,
             recipient_phone = $4, amount = $5, justification = $6,
             invoice_file_url = $7, quotation_file_url = $8,
             status = 'submitted', rejection_reason = NULL, submitted_at = now(), updated_at = now()
         WHERE id = $9`,
        [
          input.activity,
          input.recipientName,
          input.recipientAccount || null,
          input.recipientPhone || null,
          input.amount,
          input.justification,
          input.invoiceFileUrl || null,
          input.quotationFileUrl || null,
          id
        ]
      );

      await client.query('DELETE FROM approvals WHERE request_id = $1', [id]);
      await recordAudit(client, {
        requestId: id,
        actorId: req.user.id,
        action: 'request.revised_and_resubmitted',
        details: { previousStatus: request.status, amount: input.amount }
      });
    });

    const { rows } = await query('SELECT * FROM payment_requests WHERE id = $1', [id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid revised request payload', 400, err.errors));
    next(err);
  }
}

async function listRequests(req, res, next) {
  try {
    const { status, centreId, paymentType } = req.query;
    const conditions = [];
    const params = [];

    // Staff only ever see their own requests. Everyone else (Finance,
    // Director, Trustee, Admin) sees the full pipeline, per Section 10.
    if (req.user.role === 'staff') {
      params.push(req.user.id);
      conditions.push(`requester_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (centreId) {
      params.push(centreId);
      conditions.push(`centre_id = $${params.length}`);
    }
    if (paymentType) {
      params.push(paymentType);
      conditions.push(`payment_type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT * FROM payment_requests ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function getRequest(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query('SELECT * FROM payment_requests WHERE id = $1', [id]);
    const request = rows[0];
    if (!request) throw new AppError('Payment request not found', 404);

    if (req.user.role === 'staff' && request.requester_id !== req.user.id) {
      throw new AppError('You do not have access to this request', 403);
    }

    const approvalStatus = await getApprovalStatus(db, id);

    let reconciliation = null;
    if (['disbursed', 'reconciled'].includes(request.status)) {
      reconciliation = await computeReconciliationStatus(db, id, request.payment_type);
    }

    res.json({ ...request, approvalStatus, reconciliation });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRequest, reviseAndResubmit, listRequests, getRequest };
