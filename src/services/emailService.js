const nodemailer = require("nodemailer");

let transporterPromise = null;

/**
 * Build a reusable transporter
 */
const createTransporter = async () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, NODE_ENV } =
    process.env;

  // Use custom SMTP credentials if provided
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === "true",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  // Fallback to Ethereal in non-production environments
  if (NODE_ENV !== "production") {
    const testAccount = await nodemailer.createTestAccount();

    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }

  throw new Error("SMTP configuration is missing in production environment.");
};

const getTransporter = async () => {
  if (!transporterPromise) {
    transporterPromise = createTransporter();
  }

  return transporterPromise;
};

/**
 * Send verification email with a one-time verification link.
 */
const sendVerificationEmail = async ({ toEmail, name, verificationToken }) => {
  const transporter = await getTransporter();
  const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:5000";
  const fromEmail =
    process.env.MAIL_FROM || "OpenTrace <no-reply@opentrace.local>";

  const verificationUrl = `${appBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;

  const info = await transporter.sendMail({
    from: fromEmail,
    to: toEmail,
    subject: "Verify your email address",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <h2>Welcome to OpenTrace</h2>
        <p>Hello${name ? ` ${name}` : ""},</p>
        <p>Please verify your email to activate your account.</p>
        <p>
          <a
            href="${verificationUrl}"
            style="display:inline-block;padding:10px 16px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:6px;"
          >
            Verify Email
          </a>
        </p>
        <p>This link expires in 24 hours.</p>
        <p>If you did not create this account, you can safely ignore this email.</p>
      </div>
    `,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);

  // Useful for development when using Ethereal
  if (previewUrl) {
    console.log("Email preview URL:", previewUrl);
  }

  return { info, previewUrl };
};

module.exports = {
  sendVerificationEmail,
};
