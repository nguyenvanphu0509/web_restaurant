import { fileURLToPath } from 'node:url';

const images = new URL('../../../web/public/images/', import.meta.url);
const background = 'auth-background@amthucviet';
const logo = 'auth-logo@amthucviet';
const attachments = [
  { filename: 'auth-email-seafood.jpg', path: fileURLToPath(new URL('auth-email-seafood.jpg', images)), cid: background },
  { filename: 'logo.png', path: fileURLToPath(new URL('logo.png', images)), cid: logo },
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function renderEmail({ title, intro, content, note }) {
  return {
    attachments,
    html: `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @media only screen and (max-width: 620px) {
      .email-hero { height:auto !important; background-size:auto 300px !important; background-position:right bottom !important; }
      .email-copy { width:100% !important; }
      .email-content { padding:26px 22px 290px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#07131b" style="background-color:#07131b;color:#f0f4f8;font-family:Arial,sans-serif;">
    <tr><td align="center" style="padding:12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:820px;table-layout:fixed;">
        <tr><td class="email-hero" height="440" valign="middle" bgcolor="#0b1e2b" background="cid:${background}" style="background-color:#0b1e2b;background-image:url('cid:${background}');background-repeat:no-repeat;background-size:100% auto;background-position:right center;">
          <table class="email-copy" role="presentation" width="55%" cellspacing="0" cellpadding="0" style="table-layout:fixed;">
            <tr><td class="email-content" style="padding:34px 18px 34px 32px;text-align:left;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:20px;">
                <tr>
                  <td><img src="cid:${logo}" width="34" height="34" alt="" style="display:block;background-color:#ffffff;border-radius:8px;"></td>
                  <td style="padding-left:9px;color:#c8a97e;font-size:12px;font-weight:bold;letter-spacing:1px;">SEACLUB · ẨM THỰC VIỆT</td>
                </tr>
              </table>
              <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:34px;line-height:1.12;color:#f0f4f8;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#c7d5e0;">${escapeHtml(intro)}</p>
              ${content}
              <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #395061;font-size:13px;line-height:1.6;color:#c7d5e0;">${escapeHtml(note)}</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function actionLink(url, label) {
  const href = escapeHtml(url);
  return `<a href="${href}" style="display:inline-block;padding:13px 19px;border-radius:6px;background-color:#e9c46a;color:#07131b;font-size:15px;font-weight:bold;text-decoration:none;">${escapeHtml(label)}</a>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#c7d5e0;">Nếu nút không mở được, hãy sao chép liên kết bên dưới.<br>
      <a href="${href}" style="color:#e9c46a;overflow-wrap:anywhere;word-break:break-all;">${href}</a>
    </p>`;
}

export function activationEmail(otp, minutes) {
  return renderEmail({
    title: 'Kích hoạt tài khoản',
    intro: 'Chào mừng bạn đến với Ẩm Thực Việt! Hãy nhập mã dưới đây để xác minh email.',
    content: `<div style="padding:14px 16px;border:1px solid #89744b;border-radius:8px;background-color:#102837;color:#e9c46a;">
      <div style="font-size:11px;font-weight:bold;letter-spacing:2px;">MÃ XÁC THỰC</div>
      <div style="margin-top:6px;font-family:monospace;font-size:34px;font-weight:bold;letter-spacing:5px;">${escapeHtml(otp)}</div>
    </div>
    <p style="margin:14px 0 0;color:#c7d5e0;font-size:14px;line-height:1.5;">Mã có hiệu lực trong <strong>${escapeHtml(minutes)} phút</strong> và chỉ dùng được một lần.</p>`,
    note: 'Nếu bạn không yêu cầu đăng ký, bạn có thể bỏ qua email này.',
  });
}

export function resetEmail(url, minutes) {
  return renderEmail({
    title: 'Đặt lại mật khẩu',
    intro: `Dùng liên kết dưới đây để tạo mật khẩu mới. Liên kết có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.`,
    content: actionLink(url, 'Đặt lại mật khẩu'),
    note: 'Nếu bạn không yêu cầu đặt lại mật khẩu, bạn có thể bỏ qua email này.',
  });
}

export function passwordChangedEmail(url) {
  return renderEmail({
    title: 'Mật khẩu đã được thay đổi',
    intro: 'Mật khẩu tài khoản Ẩm Thực Việt của bạn đã được thay đổi.',
    content: actionLink(url, 'Yêu cầu đặt lại mật khẩu'),
    note: 'Nếu bạn không thực hiện thay đổi này, hãy yêu cầu đặt lại mật khẩu ngay.',
  });
}
