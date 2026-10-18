/** The Settings tab (Screens.kt Settings and Account.kt): for now, the account that backs up and syncs. */
import { Eye, EyeOff, KeyRound, Lock, type LucideIcon, Mail, User } from 'lucide-react';
import { type FormEvent, type InputHTMLAttributes, type ReactNode, useEffect, useState } from 'react';
import { account, ApiError, requestPasswordReset, resetPassword, signIn, signOut } from './api';
import { Sheet } from './ReaderSheets';

/** Same limit as the backend's signup validation. */
const MAX_NAME = 40;

const code = (e: unknown) => (e instanceof ApiError ? e.code : '');

function signInError(e: unknown, create: boolean): string {
  switch (code(e)) {
    case 'INVALID_CREDENTIALS':
      return 'E-mail ou senha incorretos.';
    case 'EMAIL_TAKEN':
      return 'Este e-mail já tem conta. Use "Entrar".';
    case 'TOO_MANY_ATTEMPTS':
    case 'TOO_MANY_REQUESTS':
      return 'Muitas tentativas. Tente de novo em 15 minutos.';
    case 'INVALID_REQUEST':
      return create ? 'Preencha o nome, um e-mail válido e uma senha de 8 a 128 caracteres.' : 'Informe um e-mail válido e uma senha de 8 a 128 caracteres.';
    case 'NO_CONNECTION':
      return 'Sem conexão com o servidor.';
    default:
      return 'Não foi possível entrar agora.';
  }
}

function resetError(e: unknown): string {
  switch (code(e)) {
    case 'INVALID_CODE':
      return 'Código inválido ou expirado. Peça um novo.';
    case 'RESET_UNAVAILABLE':
      return 'A recuperação de senha ainda não está configurada neste servidor.';
    case 'TOO_MANY_ATTEMPTS':
    case 'TOO_MANY_REQUESTS':
      return 'Muitas tentativas. Tente de novo em 15 minutos.';
    case 'INVALID_REQUEST':
      return 'Confira o código de 6 dígitos e a nova senha (mínimo de 8 caracteres).';
    case 'NO_CONNECTION':
      return 'Sem conexão com o servidor.';
    default:
      return 'Não foi possível entrar agora.';
  }
}

export function Settings() {
  const [me, setMe] = useState(account);
  const [signingIn, setSigningIn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <main className="page">
      <h1 className="page-title">Ajustes</h1>
      <h2 className="section-head">Conta e backup</h2>
      {me ? (
        <div className="card account-card">
          <span className="avatar">{(me.name ?? me.email).slice(0, 1).toUpperCase()}</span>
          <span className="account-text">
            <strong>{me.name ?? me.email}</strong>
            {me.name && <span className="small muted">{me.email}</span>}
            <span className="small muted">Ainda não sincronizado</span>
          </span>
        </div>
      ) : (
        <button type="button" className="card setting" onClick={() => setSigningIn(true)}>
          <strong>Entrar ou criar conta</strong>
          <span className="small muted">Backup e sincronização de livros, progresso, vocabulário e destaques entre aparelhos</span>
        </button>
      )}
      <p className="card hint">Tema, metas, lembrete, voz e idioma padrão chegam no próximo passo.</p>
      {me && (
        <button type="button" className="text danger wide sign-out" onClick={() => setConfirming(true)}>
          Sair da conta
        </button>
      )}

      {signingIn && (
        <SignInSheet
          onDone={(message) => {
            setMe(account());
            setSigningIn(false);
            if (message) setToast(message);
          }}
          onClose={() => setSigningIn(false)}
        />
      )}
      {confirming && (
        <div className="sheet-backdrop center-dialog" onClick={() => setConfirming(false)}>
          <div className="card dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Sair da conta?</h2>
            <p className="muted">A sincronização para até você entrar de novo. Nada é apagado deste aparelho.</p>
            <div className="row center">
              <button type="button" className="button outline" onClick={() => setConfirming(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  signOut();
                  setMe(null);
                  setConfirming(false);
                }}
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <p className="toast">{toast}</p>}
    </main>
  );
}

function Field({ icon: Icon, label, hint, trailing, ...input }: { icon: LucideIcon; label: string; hint?: string; trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span className="field-box">
        <Icon size={20} />
        <input placeholder={label} aria-label={label} {...input} />
        {trailing}
      </span>
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

function SignInSheet({ onDone, onClose }: { onDone: (message?: string) => void; onClose: () => void }) {
  const [create, setCreate] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !busy && email.trim() !== '' && password !== '' && (!create || name.trim() !== '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password, create ? name.trim() : undefined);
      onDone();
    } catch (err) {
      setError(signInError(err, create));
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose}>
      <img className="mascot" src="/art/mascot.png" alt="" width={88} height={88} />
      {resetting ? (
        <PasswordReset initialEmail={email} onBack={() => setResetting(false)} onDone={() => onDone('Senha alterada. Você já está conectado.')} />
      ) : (
        <form className="auth" onSubmit={submit}>
          <h2>{create ? 'Crie sua conta' : 'Entre na sua conta'}</h2>
          <p className="muted">Seus livros, vocabulário e ofensiva guardados na nuvem e em todos os seus aparelhos.</p>
          <div className="segmented">
            {['Entrar', 'Criar conta'].map((label, i) => (
              <button
                type="button"
                key={label}
                className={create === (i === 1) ? 'on' : ''}
                onClick={() => {
                  setCreate(i === 1);
                  setError(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {create && (
            <Field
              icon={User}
              label="Nome"
              hint="Como você quer ser chamado no app"
              value={name}
              maxLength={MAX_NAME}
              autoComplete="name"
              autoCapitalize="words"
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <Field
            icon={Mail}
            label="E-mail"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            icon={Lock}
            label="Senha"
            type={showPassword ? 'text' : 'password'}
            autoComplete={create ? 'new-password' : 'current-password'}
            maxLength={128}
            hint={create ? 'Mínimo de 8 caracteres' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            trailing={
              <button type="button" className="icon" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            }
          />
          {!create && (
            <button
              type="button"
              className="text end"
              onClick={() => {
                setResetting(true);
                setError(null);
              }}
            >
              Esqueci minha senha
            </button>
          )}
          {error && <p className="error-box">{error}</p>}
          <button type="submit" className="button primary wide" disabled={!ready}>
            {busy ? 'Aguarde…' : create ? 'Criar conta' : 'Entrar'}
          </button>
        </form>
      )}
    </Sheet>
  );
}

/** "Forgot my password": ask for a code by email, then type it with the new password. Signs in at the end. */
function PasswordReset({ initialEmail, onBack, onDone }: { initialEmail: string; onBack: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !busy && (sent ? code.length === 6 && password.length >= 8 : email.trim() !== '');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(resetError(e));
    }
    setBusy(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    if (!sent)
      run(async () => {
        await requestPasswordReset(email.trim());
        setSent(true);
      });
    else
      run(async () => {
        await resetPassword(email.trim(), code, password);
        onDone();
      });
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h2>Criar nova senha</h2>
      <p className="muted">
        {sent
          ? `Digite o código que enviamos para ${email.trim()} e escolha a nova senha. Ele vale por 15 minutos.`
          : 'Enviaremos um código de 6 dígitos para o seu e-mail.'}
      </p>
      {sent ? (
        <>
          <Field
            icon={KeyRound}
            label="Código de 6 dígitos"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <Field
            icon={Lock}
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            hint="Mínimo de 8 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      ) : (
        <Field icon={Mail} label="E-mail" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      )}
      {error && <p className="error-box">{error}</p>}
      <button type="submit" className="button primary wide" disabled={!ready}>
        {busy ? 'Aguarde…' : sent ? 'Salvar nova senha' : 'Enviar código'}
      </button>
      {sent && (
        <button type="button" className="text" disabled={busy} onClick={() => run(() => requestPasswordReset(email.trim()).then(() => undefined))}>
          Reenviar código
        </button>
      )}
      <button type="button" className="text" onClick={onBack}>
        Voltar para entrar
      </button>
    </form>
  );
}
