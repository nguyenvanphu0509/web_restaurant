import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export function Security() {
  const { adoptSession } = useAuth();
  const [status, setStatus] = useState(null), [setup, setSetup] = useState(null), [codes, setCodes] = useState(null);
  const [password, setPassword] = useState(''), [otp, setOtp] = useState(''), [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const reload = () => api('/auth/mfa').then(result => setStatus(result.data));
  useEffect(() => { const controller = new AbortController(); api('/auth/mfa', { signal: controller.signal }).then(result => setStatus(result.data)).catch(error => { if (!controller.signal.aborted) setError(error.message); }); return () => controller.abort(); }, []);
  async function submit(event, action) {
    event.preventDefault(); if (pending) return;
    setPending(true); setError(''); setMessage(''); setCodes(null);
    try {
      const result = await api(`/auth/mfa/${action}`, { method: 'POST', data: { password, ...(useRecovery && action !== 'confirm' ? { recoveryCode } : { otp }) } });
      if (action === 'cancel') { setSetup(null); }
      else if (action === 'setup') { setSetup(result.data); setUseRecovery(false); }
      else {
        adoptSession(result.data); setSetup(null); setCodes(result.data.recoveryCodes || null);
        setMessage(action === 'disable' ? 'Đã tắt MFA.' : 'Đã cập nhật MFA. Hãy lưu mã dự phòng ở nơi riêng.'); await reload();
      }
      setPassword(''); setOtp(''); setRecoveryCode('');
    } catch (error) { setError(error.message); }
    finally { setPending(false); }
  }
  return <main id="main" className="shell page-main"><section className="form-card"><h1>Bảo mật tài khoản</h1>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {status && <p>MFA: <strong>{status.enabled ? 'Đã bật' : 'Chưa bật'}</strong> · Mã dự phòng còn lại: {status.remaining}</p>}
    {codes && <section aria-label="Mã dự phòng"><h2>Lưu mã dự phòng</h2><p>Mỗi mã chỉ dùng một lần. Các mã gốc chỉ hiển thị lần này.</p><ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul></section>}
    {setup ? <form onSubmit={event => submit(event, 'confirm')}><h2>Quét bằng Authenticator</h2><p>Thiết lập hết hạn sau 10 phút. MFA chỉ bật sau khi xác nhận mã đúng.</p><img src={setup.qr} width="240" height="240" alt="QR thiết lập Authenticator"/><p>Nhập tay nếu cần: <code className="mfa-secret">{setup.secret}</code></p><label className="field">Mã xác nhận<input required value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0,6))} inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code"/></label><div className="form-actions"><button className="button" disabled={pending}>Xác nhận bật MFA</button><button className="button outline" type="button" disabled={pending} onClick={event => submit(event, 'cancel')}>Hủy</button></div></form>
    : status && <form onSubmit={event => submit(event, 'setup')}><h2>{status.enabled ? 'Quản lý Authenticator' : 'Bật MFA với Authenticator'}</h2><label className="field">Mật khẩu<input type="password" required value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" maxLength={128}/></label>
      {status.enabled && <><label className="field">{useRecovery ? 'Mã dự phòng' : 'Mã Authenticator'}<input required value={useRecovery ? recoveryCode : otp} onChange={event => useRecovery ? setRecoveryCode(event.target.value) : setOtp(event.target.value.replace(/\D/g, '').slice(0,6))} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete={useRecovery ? 'off' : 'one-time-code'}/></label><button type="button" className="auth-forgot-link" onClick={() => { setUseRecovery(value => !value); setOtp(''); setRecoveryCode(''); }}>{useRecovery ? 'Dùng Authenticator' : 'Dùng mã dự phòng'}</button></>}
      <div className="form-actions"><button className="button" disabled={pending}>{status.enabled ? 'Thay điện thoại' : 'Bắt đầu thiết lập'}</button>{status.enabled && <><button className="button outline" type="submit" disabled={pending} onClick={event => { if (event.currentTarget.form.reportValidity()) submit(event, 'disable'); }}>Tắt MFA</button><button className="button outline" type="submit" disabled={pending} onClick={event => { if (event.currentTarget.form.reportValidity()) submit(event, 'recovery/regenerate'); }}>Tạo lại mã dự phòng</button></>}</div></form>}
    <p>Mã Authenticator khác OTP email. Nếu mã sai liên tục, bật ngày giờ tự động trên điện thoại. Không chia sẻ QR, secret hoặc mã dự phòng.</p>
  </section></main>;
}
