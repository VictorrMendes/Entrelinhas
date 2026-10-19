/** The Settings tab (Screens.kt Settings and Account.kt). */
import syncSvg from '@material-design-icons/svg/outlined/sync.svg?raw';
import { Email, Lock, Person, Pin, Visibility, VisibilityOff } from './icons';
import { type FormEvent, type InputHTMLAttributes, type ReactNode, useEffect, useState } from 'react';
import { account, ApiError, requestPasswordReset, resetPassword, signIn, signOut } from './api';
import { sync, useSyncState } from './cloud';
import { speechRate } from './Dictation';
import { langName } from './Learn';
import { LANGUAGES, Sheet } from './ReaderSheets';
import { rateLabel, SPEECH_RATES } from './ReaderTools';
import { type Book, dailyGoalMinutes, db, deleteBook } from './store';
import { AlertDialog, ChoiceDialog, Confirm, Icon, ScreenTitle, Section, SettingCard, appTheme, applyTheme } from './ui';
import { defaultTarget } from './words';

function syncStatus({ syncing, lastSync }: { syncing: boolean; lastSync: number }): string {
  if (syncing) return 'Sincronizando…';
  if (!lastSync) return 'Ainda não sincronizado';
  const at = new Date(lastSync);
  return at.toDateString() === new Date().toDateString()
    ? `Sincronizado às ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : `Sincronizado em ${at.toLocaleDateString('pt-BR')}`;
}

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

const THEMES = [
  { title: 'Padrão do sistema', subtitle: 'Segue o tema do celular' },
  { title: 'Claro', subtitle: 'Sempre claro' },
  { title: 'Escuro', subtitle: 'Sempre escuro' },
];
const GOAL_OPTIONS = [3, 5, 10, 15, 20, 30];

type Dialog = 'theme' | 'goal' | 'speed' | 'language' | 'books' | 'signOut';

/** The Settings tab, card for card like the Android app's (what only a phone can do — reminders, offline models, updates — stays out). */
export function Settings() {
  // read on every redraw: a sync can sign out by itself when the session expires
  const [, redraw] = useState(0);
  const me = account();
  const [signingIn, setSigningIn] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const syncState = useSyncState();
  const set = (key: string, value: string | number) => {
    localStorage.setItem(key, String(value));
    redraw((v) => v + 1);
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <main className="tab-page">
      <ScreenTitle>Ajustes</ScreenTitle>
      <div className="settings">
        <Section>Conta e backup</Section>
        {me ? (
          <div className="card account-card">
            <span className="avatar title-medium">{(me.name ?? me.email).slice(0, 1).toUpperCase()}</span>
            <span className="account-text">
              <span className="title-medium">{me.name ?? me.email}</span>
              {me.name && <span className="body-medium variant">{me.email}</span>}
              <span className="body-small variant">{syncStatus(syncState)}</span>
            </span>
            <button type="button" className={`icon${syncState.syncing ? ' spinning' : ''}`} aria-label="Sincronizar agora" disabled={syncState.syncing} onClick={() => sync()}>
              <Icon svg={syncSvg} />
            </button>
          </div>
        ) : (
          <SettingCard title="Entrar ou criar conta" subtitle="Backup e sincronização de livros, progresso, vocabulário e destaques entre aparelhos" onClick={() => setSigningIn(true)} />
        )}
        <Section>Aplicativo</Section>
        <SettingCard title="Tema" value={THEMES[appTheme()]?.title ?? THEMES[0].title} onClick={() => setDialog('theme')} />
        <Section>Leitura</Section>
        <SettingCard title="Meta diária" value={`${dailyGoalMinutes()} min`} onClick={() => setDialog('goal')} />
        <SettingCard title="Velocidade da voz" value={rateLabel(speechRate())} onClick={() => setDialog('speed')} />
        <Section>Tradução</Section>
        <SettingCard title="Idioma padrão de tradução" value={langName(defaultTarget())} onClick={() => setDialog('language')} />
        <Section>Armazenamento</Section>
        <SettingCard title="Excluir todos os livros" subtitle="Remove os livros importados e suas imagens" onClick={() => setDialog('books')} />
        <Section>Sobre o app</Section>
        <SettingCard title="Sobre" subtitle={`Versão web ${__BUILD__} · servidor ${location.host}`} />
        {me && (
          <button type="button" className="sign-out-button title-medium" onClick={() => setDialog('signOut')}>
            Sair da conta
          </button>
        )}
      </div>

      {dialog === 'theme' && (
        <ChoiceDialog
          title="Tema"
          options={THEMES}
          selected={appTheme()}
          onPick={(i) => {
            set('theme', i);
            applyTheme(i);
          }}
          onDismiss={() => setDialog(null)}
        />
      )}
      {dialog === 'goal' && (
        <ChoiceDialog
          title="Meta diária"
          options={GOAL_OPTIONS.map((m) => ({ title: `${m} min por dia`, subtitle: `Ler ${m} min mantém a ofensiva` }))}
          selected={GOAL_OPTIONS.indexOf(dailyGoalMinutes())}
          onPick={(i) => set('dailyGoalMinutes', GOAL_OPTIONS[i])}
          onDismiss={() => setDialog(null)}
        />
      )}
      {dialog === 'speed' && (
        <ChoiceDialog
          title="Velocidade da voz"
          options={SPEECH_RATES.map((r) => ({ title: rateLabel(r) }))}
          selected={SPEECH_RATES.indexOf(speechRate())}
          onPick={(i) => set('speechRate', SPEECH_RATES[i])}
          onDismiss={() => setDialog(null)}
        />
      )}
      {dialog === 'language' && (
        <AlertDialog
          title="Idioma de tradução"
          onDismiss={() => setDialog(null)}
          actions={
            <button type="button" className="text-button" onClick={() => setDialog(null)}>
              Fechar
            </button>
          }
        >
          <div className="language-list body-large">
            {[...LANGUAGES]
              .sort((a, b) => langName(a).localeCompare(langName(b)))
              .map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className={tag === defaultTarget() ? 'on' : ''}
                  onClick={() => {
                    set('defaultTarget', tag);
                    setDialog(null);
                  }}
                >
                  {langName(tag)}
                </button>
              ))}
          </div>
        </AlertDialog>
      )}
      {dialog === 'books' && (
        <Confirm
          title="Excluir todos os livros?"
          text="Remove todos os livros importados e o progresso. Essa ação não pode ser desfeita."
          onConfirm={async () => {
            for (const b of await db.all<Book>('books')) await deleteBook(b.id as number);
          }}
          onDismiss={() => setDialog(null)}
        />
      )}
      {dialog === 'signOut' && (
        <Confirm
          title="Sair da conta?"
          text="A sincronização para até você entrar de novo. Nada é apagado deste aparelho."
          action="Sair"
          onConfirm={() => {
            signOut();
            redraw((v) => v + 1);
          }}
          onDismiss={() => setDialog(null)}
        />
      )}
      {signingIn && (
        <SignInSheet
          onDone={(message) => {
            setSigningIn(false);
            redraw((v) => v + 1);
            if (message) setToast(message);
            sync();
          }}
          onClose={() => setSigningIn(false)}
        />
      )}
      {toast && <p className="toast">{toast}</p>}
    </main>
  );
}

function Field({ icon: Icon, label, hint, trailing, ...input }: { icon: typeof Lock; label: string; hint?: string; trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
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
              icon={Person}
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
            icon={Email}
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
                {showPassword ? <VisibilityOff size={20} /> : <Visibility size={20} />}
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
            icon={Pin}
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
        <Field icon={Email} label="E-mail" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
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
