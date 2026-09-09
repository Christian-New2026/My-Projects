const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { query } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const crypto = require('crypto');
const { sendPasswordApprovalEmail } = require('../services/emailService');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const { rows } = await query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    const user = rows[0];
    if (!user) throw new AppError('Invalid email or password', 401);

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new AppError('Invalid email or password', 401);

    const token = jwt.sign(
      { sub: user.id, role: user.role, centreId: user.centre_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, centreId: user.centre_id }
    });
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid login payload', 400, err.errors));
    return next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const input = changePasswordSchema.parse(req.body);
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1 AND is_active = true', [req.user.id]);
    const user = rows[0];
    if (!user) throw new AppError('User not found', 404);

    const currentPasswordMatches = await bcrypt.compare(input.currentPassword, user.password_hash);
    if (!currentPasswordMatches) throw new AppError('Current password is incorrect', 400);

    const { rows: pendingRows } = await query(
      `SELECT id FROM password_change_requests
       WHERE user_id = $1 AND status = 'pending' AND expires_at > now()`,
      [req.user.id]
    );
    if (pendingRows[0]) throw new AppError('A password change request is already awaiting approval', 409);

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { rows: userRows } = await query('SELECT name, email FROM users WHERE id = $1', [req.user.id]);
    const requester = userRows[0];
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO password_change_requests
       (user_id, new_password_hash, approval_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, passwordHash, tokenHash, expiresAt]
    );

    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    try {
      await sendPasswordApprovalEmail({
        requesterName: requester.name,
        requesterEmail: requester.email,
        approveUrl: `${baseUrl}/api/auth/password-approval/${rawToken}/approve`,
        rejectUrl: `${baseUrl}/api/auth/password-approval/${rawToken}/reject`
      });
    } catch (emailError) {
      await query('DELETE FROM password_change_requests WHERE approval_token_hash = $1', [tokenHash]);
      throw new AppError(emailError.message, 503);
    }

    res.json({ message: 'Password change request sent for approval. Your password will change after approval.' });
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid password change payload', 400, err.errors));
    next(err);
  }
}

async function reviewPasswordChange(req, res, next) {
  try {
    const action = req.params.action;
    if (!['approve', 'reject'].includes(action)) throw new AppError('Invalid approval action', 400);
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const { rows } = await query(
      `SELECT pcr.*, u.name FROM password_change_requests pcr
       JOIN users u ON u.id = pcr.user_id
       WHERE pcr.approval_token_hash = $1 AND pcr.status = 'pending' AND pcr.expires_at > now()`,
      [tokenHash]
    );
    const request = rows[0];
    if (!request) throw new AppError('This password approval link is invalid, expired, or already used', 410);

    if (action === 'approve') {
      await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [request.new_password_hash, request.user_id]);
    }
    await query(
      'UPDATE password_change_requests SET status = $1, reviewed_at = now() WHERE id = $2',
      [action === 'approve' ? 'approved' : 'rejected', request.id]
    );
    const message = action === 'approve' ? `Password change approved for ${request.name}.` : `Password change rejected for ${request.name}.`;
    res.type('html').send(`<main style="font-family: sans-serif; max-width: 600px; margin: 3rem auto"><h1>${message}</h1><p>The approval link can no longer be used.</p></main>`);
  } catch (err) {
    next(err);
  }
}

module.exports = { login, changePassword, reviewPasswordChange };
