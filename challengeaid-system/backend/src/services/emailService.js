const nodemailer = require('nodemailer');

function getTransporter() {
    const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
        throw new Error(`Email is not configured. Missing: ${missing.join(', ')}`);
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
}

async function sendPasswordApprovalEmail({ requesterName, requesterEmail, approveUrl, rejectUrl }) {
    const transporter = getTransporter();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await transporter.sendMail({
        from,
        to: process.env.PASSWORD_APPROVER_EMAIL || 'ochandadavid377@gmail.com',
        subject: `Password change approval requested by ${requesterName}`,
        text: [
            `${requesterName} (${requesterEmail}) has requested a password change.`,
            '',
            `Approve: ${approveUrl}`,
            `Reject: ${rejectUrl}`,
            '',
            'These links expire in 24 hours. The new password is never included in this email.'
        ].join('\n'),
        html: `<p><strong>${requesterName}</strong> (${requesterEmail}) has requested a password change.</p><p><a href="${approveUrl}">Approve password change</a></p><p><a href="${rejectUrl}">Reject password change</a></p><p>These links expire in 24 hours. The new password is never included in this email.</p>`
    });
}

module.exports = { sendPasswordApprovalEmail };
