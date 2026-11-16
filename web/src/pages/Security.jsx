import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { useLoad } from '../hooks.js';
import './security.css';

const authenticatorHelp = <>Lấy mã xác minh trong ứng dụng Authenticator. Mã gửi qua email chỉ dùng để xác minh email. Nếu mã Authenticator liên tục báo sai, hãy bật <strong>Ngày giờ tự động</strong> trên điện thoại rồi thử lại với mã mới. Giữ kín mã QR, khóa thiết lập và mã dự phòng.</>;
const sixDigits = value => value.replace(/\D/g, '').slice(0, 6);

export function SecurityDialog({ onDismiss }) {
  const dialog = useRef(null);
  const heading = useRef(null);
  const titleId = useId();
  const { adoptSession } = useAuth();
  const loaded = useLoad('mfa', signal => api('/auth/mfa', { signal }));
  const [updatedStatus, setUpdatedStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const status = updatedStatus || loaded.result?.data;
  const step = codes ? 'codes' : setup ? 'setup' : status ? 'manage' : 'loading';
  const title = codes ? 'Đã bật xác thực hai bước' : setup ? 'Cài đặt trên điện thoại' : 'Bảo vệ mật khẩu';

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  useEffect(() => {
    dialog.current.scrollTop = 0;
    heading.current.focus({ preventScroll: true });
  }, [step]);

  function dismiss() {
    dialog.current.close();
    onDismiss();
  }

  async function submit(action, { dismissAfterCancel = false } = {}) {
    if (pending) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`/auth/mfa/${action}`, {
        method: 'POST',
        data: action === 'confirm' ? { otp } : action === 'cancel' ? {}
          : { password, ...(useRecovery ? { recoveryCode } : { otp }) },
      });
      if (!dialog.current?.open) return;

      if (action === 'cancel') {
        setSetup(null);
        if (dismissAfterCancel) dismiss();
      } else if (action === 'setup') {
        setSetup(result.data);
        setUseRecovery(false);
      } else {
        adoptSession(result.data);
        const recoveryCodes = result.data.recoveryCodes;
        setSetup(null);
        setCodes(recoveryCodes || null);
        setUpdatedStatus({ enabled: action !== 'disable', remaining: recoveryCodes?.length || 0 });
        if (action === 'disable') setMessage('Đã tắt xác thực hai bước.');
      }
      setPassword('');
      setOtp('');
      setRecoveryCode('');
    } catch (error) {
      setError(error.message);
      if (action === 'confirm' && error.code === 'INVALID_MFA_CHALLENGE') {
        setSetup(null);
        setOtp('');
      }
    } finally {
      setPending(false);
    }
  }

  function close() {
    if (pending || codes) return;
    if (setup) submit('cancel', { dismissAfterCancel: true });
    else dismiss();
  }

  return (
    <dialog ref={dialog} className="security-dialog" aria-labelledby={titleId} onCancel={event => {
      event.preventDefault();
      close();
    }}>
      <header className="security-dialog-header">
        {!codes && <button className="security-close" type="button" aria-label="Đóng" disabled={pending} onClick={close}>×</button>}
        {codes && <span className="security-success-icon" aria-hidden="true">✓</span>}
        <h2 ref={heading} id={titleId} tabIndex={-1}>{title}</h2>
      </header>

      {error && <p className="security-note security-error" role="alert">{error}</p>}
      {message && <p className="security-note" role="status">{message}</p>}
      {pending && <p className="catalog-sr-only" role="status">Đang xử lý…</p>}

      {codes ? <RecoveryCodes codes={codes} onDone={dismiss}/> : setup ? (
        <form className="security-form" onSubmit={event => {
          event.preventDefault();
          submit('confirm');
        }}>
          <ol className="security-instructions">
            <li>Trong ứng dụng Authenticator, chọn thêm tài khoản rồi quét mã QR.</li>
            <li>Nhập mã 6 số đang hiện trong ứng dụng để xác nhận.</li>
          </ol>
          <img className="security-qr" src={setup.qr} width="176" height="176" alt="QR thiết lập Authenticator"/>
          <div className="security-key">
            <span>Không quét được? Nhập khóa thiết lập trong ứng dụng.</span>
            <code className="mfa-secret">{setup.secret}</code>
          </div>
          <label className="security-field">
            Mã xác nhận
            <input className="security-otp" required value={otp} onChange={event => setOtp(sixDigits(event.target.value))}
              inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" placeholder="000000"/>
          </label>
          <p className="security-field-hint">Bạn có 10 phút để xác nhận thiết lập.</p>
          <div className="security-actions">
            <button className="security-button" type="button" disabled={pending} onClick={() => submit('cancel')}>Hủy</button>
            <button className="security-button security-primary" disabled={pending}>{status.enabled ? 'Xác nhận thay điện thoại' : 'Xác nhận bật MFA'}</button>
          </div>
        </form>
      ) : status ? (
        <>
          <p className="security-description">Dùng ứng dụng Authenticator để thêm một bước xác minh khi đăng nhập.</p>
          <p className="security-status">
            <span>Xác thực hai bước</span>
            <strong className={status.enabled ? 'security-enabled' : ''}>{status.enabled ? 'Đã bật' : 'Chưa bật'}</strong>
          </p>
          {status.enabled && <p className="security-remaining">Mã dự phòng còn lại <strong>{status.remaining}</strong></p>}
          <form className="security-form" onSubmit={event => {
            event.preventDefault();
            submit(event.nativeEvent.submitter?.value || 'setup');
          }}>
            <label className="security-field">
              Mật khẩu
              <input type="password" required value={password} onChange={event => setPassword(event.target.value)}
                autoComplete="current-password" maxLength={128} placeholder="Nhập mật khẩu hiện tại"/>
            </label>
            {status.enabled && (
              <>
                <label className="security-field">
                  {useRecovery ? 'Mã dự phòng' : 'Mã Authenticator'}
                  <input required value={useRecovery ? recoveryCode : otp}
                    onChange={event => useRecovery ? setRecoveryCode(event.target.value) : setOtp(sixDigits(event.target.value))}
                    inputMode={useRecovery ? 'text' : 'numeric'} pattern={useRecovery ? undefined : '[0-9]{6}'}
                    autoComplete={useRecovery ? 'off' : 'one-time-code'}/>
                </label>
                <button type="button" className="security-text-button" disabled={pending} onClick={() => {
                  setUseRecovery(value => !value);
                  setOtp('');
                  setRecoveryCode('');
                }}>{useRecovery ? 'Dùng Authenticator' : 'Dùng mã dự phòng'}</button>
              </>
            )}
            <div className="security-actions">
              <button className="security-button security-primary" value="setup" disabled={pending}>{status.enabled ? 'Thay điện thoại' : 'Bắt đầu thiết lập'}</button>
              {status.enabled && (
                <>
                  <button className="security-button" value="recovery/regenerate" disabled={pending}>Tạo lại mã dự phòng</button>
                  <button className="security-button" value="disable" disabled={pending}>Tắt MFA</button>
                </>
              )}
            </div>
          </form>
          <p className="security-note">{authenticatorHelp}</p>
        </>
      ) : loaded.error ? (
        <>
          <p className="security-note security-error" role="alert">{loaded.error.message}</p>
          <button type="button" className="security-button" onClick={loaded.retry}>Thử lại</button>
        </>
      ) : <p className="security-description" role="status">Đang tải trạng thái bảo mật…</p>}
    </dialog>
  );
}

function RecoveryCodes({ codes, onDone }) {
  const [saved, setSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const codesText = codes.join('\n');

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codesText);
      setCopyStatus('Đã sao chép mã dự phòng.');
    } catch {
      setCopyStatus('Không thể sao chép. Bạn có thể tải mã về máy.');
    }
  }

  function downloadCodes() {
    const url = URL.createObjectURL(new Blob([`${codesText}\n`], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ma-du-phong.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="security-recovery" aria-label="Mã dự phòng">
      <p className="security-note"><strong>Cất mã dự phòng ở nơi an toàn.</strong> Dùng các mã này để đăng nhập khi bạn không thể mở Authenticator. Mỗi mã chỉ dùng một lần và danh sách này chỉ hiện ở bước này.</p>
      <ol className="security-code-list">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
      <div className="security-actions">
        <button type="button" className="security-button" onClick={copyCodes}>Sao chép</button>
        <button type="button" className="security-button" onClick={downloadCodes}>Tải về máy</button>
      </div>
      {copyStatus && <p className="security-copy-status" role="status">{copyStatus}</p>}
      <label className="security-checkbox"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/>Tôi đã cất mã dự phòng ở nơi an toàn</label>
      <div className="security-actions">
        <button type="button" className="security-button security-primary" disabled={!saved} onClick={onDone}>Hoàn tất</button>
      </div>
    </section>
  );
}
