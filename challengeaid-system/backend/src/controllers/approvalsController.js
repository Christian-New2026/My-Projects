const { z } = require('zod');
const { AppError } = require('../middleware/errorHandler');
const { recordApprovalDecision } = require('../services/approvalService');

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'more_info_requested']),
  comments: z.string().max(2000).optional()
});

async function decide(req, res, next) {
  try {
    const { id } = req.params; // request id
    const input = decisionSchema.parse(req.body);

    if (['rejected', 'more_info_requested'].includes(input.decision) && !input.comments?.trim()) {
      throw new AppError(
        input.decision === 'rejected'
          ? 'A rejection requires comments explaining why'
          : 'Requesting more information requires comments explaining what must be corrected',
        400
      );
    }

    const result = await recordApprovalDecision({
      requestId: id,
      approver: req.user,
      decision: input.decision,
      comments: input.comments
    });

    res.json(result);
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid decision payload', 400, err.errors));
    next(err);
  }
}

module.exports = { decide };
