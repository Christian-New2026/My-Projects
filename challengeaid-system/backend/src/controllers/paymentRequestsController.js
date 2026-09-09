const { z } = require('zod');
const db = require('../config/db');
const { query, withTransaction } = db;
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/auditLog');
const { assertBudgetAvailable } = require('../services/budgetService');
const { getApprovalStatus } = require('../services/approvalService');
const { computeReconciliationStatus } = require('../services/reconciliationService');

const allocationLineSchema = z.object({
  centreId: z.string().uuid().optional(),
  clusterName: z.string().min(1).optional(),
  description: z.string().min(1),
  units: z.number().positive(),
  unitCost: z.number().positive(),
  notes: z.string().max(2000).optional()
}).refine((line) => line.centreId || line.clusterName, {
  message: 'Each allocation line needs a centre or cluster'
});

const createSchema = z
  .object({
    centreId: z.string().uuid(),
    budgetLineId: z.string().uuid(),
    scopeType: z.enum(['single_center', 'single_cluster', 'multi_cluster']).default('single_center'),
    scopeLabel: z.string().min(1).optional(),
    selectedCentreIds: z.array(z.string().uuid()).min(1),
    allocationLines: z.array(allocationLineSchema).min(1),
    activity: z.string().min(1),
    paymentType: z.enum(['coach_fee', 'foodstuffs', 'supplies', 'cleaning', 'other']),
    recipientName: z.string().min(1),
    recipientAccount: z.string().min(1).optional(),
    recipientPhone: z.string().min(1).optional(),
    amount: z.number().positive().optional(),
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
  })
  .refine((v) => v.allocationLines.reduce((sum, line) => sum + line.units * line.unitCost, 0) > 0, {
    message: 'Allocation lines must have a positive total',
    path: ['allocationLines']
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
      const amount = input.allocationLines.reduce((sum, line) => sum + line.units * line.unitCost, 0);
      await assertBudgetAvailable(client, { budgetLineId: input.budgetLineId, amount });

      const { rows } = await client.query(
        `INSERT INTO payment_requests
            (requester_id, centre_id, budget_line_id, scope_type, scope_label, activity, payment_type, other_payment_type,
            recipient_name, recipient_account, recipient_phone, amount, justification,
            invoice_file_url, quotation_file_url, status, submitted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'submitted', now())
         RETURNING *`,
        [
          req.user.id,
          input.centreId,
          input.budgetLineId,
          input.scopeType,
          input.scopeLabel || null,
          input.activity,
          input.paymentType,
          input.otherPaymentType || null,
          input.recipientName,
          input.recipientAccount || null,
          input.recipientPhone || null,
          amount,
          input.justification,
          input.invoiceFileUrl || null,
          input.quotationFileUrl || null
        ]
      );

      for (const centreId of input.selectedCentreIds) {
        await client.query(
          'INSERT INTO payment_request_centres (request_id, centre_id) VALUES ($1, $2)',
          [rows[0].id, centreId]
        );
      }
      for (const line of input.allocationLines) {
        await client.query(
          `INSERT INTO payment_request_lines
             (request_id, centre_id, cluster_name, description, units, unit_cost, total, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [rows[0].id, line.centreId || null, line.clusterName || null, line.description,
            line.units, line.unitCost, line.units * line.unitCost, line.notes || null]
        );
      }

      await recordAudit(client, {
        requestId: rows[0].id,
        actorId: req.user.id,
        action: 'request.submitted',
        details: { amount, paymentType: input.paymentType, scopeType: input.scopeType }
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
    const { rows: allocationLines } = await query(
      `SELECT prl.*, c.name AS centre_name, c.location AS centre_location
       FROM payment_request_lines prl
       LEFT JOIN centres c ON c.id = prl.centre_id
       WHERE prl.request_id = $1 ORDER BY prl.created_at`,
      [id]
    );
    const { rows: selectedCentres } = await query(
      `SELECT c.id, c.name, c.location
       FROM payment_request_centres prc JOIN centres c ON c.id = prc.centre_id
       WHERE prc.request_id = $1 ORDER BY c.location, c.name`,
      [id]
    );

    let reconciliation = null;
    if (['disbursed', 'reconciled'].includes(request.status)) {
      reconciliation = await computeReconciliationStatus(db, id, request.payment_type);
    }

    res.json({ ...request, allocationLines, selectedCentres, approvalStatus, reconciliation });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRequest, reviseAndResubmit, listRequests, getRequest };
