const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { query } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

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

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid password change payload', 400, err.errors));
    next(err);
  }
}

module.exports = { login, changePassword };
