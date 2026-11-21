import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import {
  DEPARTMENT_SCOPED_ROLES,
  ROLE_LABELS,
  type RoleName,
  type UserStatus,
} from '@venue/shared';
import {
  CheckCircle,
  CaretDown,
  Eye,
  EyeSlash,
  Info,
  SpinnerGap,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

/* ------------------------------------------------------------------ brand */

export function BrandMark({ size = 32, tone = 'dark' }: { size?: number; tone?: 'light' | 'dark' }) {
  const bg = tone === 'light' ? 'var(--surface)' : 'var(--accent)';
  const iconStroke = tone === 'light' ? 'var(--accent)' : 'var(--surface)';
  const accent = tone === 'light' ? 'var(--accent)' : '#c3e2d7';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="8" fill={bg} />
      <path d="M10 25V14L18 9L26 14V25" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 25V18H21V25" stroke={iconStroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 25H28" stroke={iconStroke} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLockup({
  compact = false,
  tone = 'dark',
}: {
  compact?: boolean;
  tone?: 'light' | 'dark';
}) {
  return (
    <span className={`brand-lockup ${tone === 'light' ? 'brand-on-dark' : ''}`}>
      <BrandMark size={compact ? 26 : 30} tone={tone} />
      <span className="brand-copy">
        <span className="brand-name">Campus Venue</span>
        {!compact && <span className="brand-sub">Operations</span>}
      </span>
    </span>
  );
}

/* ----------------------------------------------------------------- loading */

export function Spinner({ size = 18 }: { size?: number }) {
  return <SpinnerGap size={size} className="spin" aria-hidden="true" />;
}

export function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="full-loader" role="status" aria-live="polite">
      <BrandLockup />
      <span className="full-loader-line">
        <Spinner size={20} />
        {label}
      </span>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

/* ----------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ fields */

interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}

function FieldShell({ id, label, error, hint, optional, children }: FieldShellProps) {
  return (
    <div className={`field ${error ? 'field-invalid' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional && <span className="field-optional">Optional</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          <WarningCircle size={14} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'id'> {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
}

export function TextField({
  label,
  error,
  hint,
  optional,
  leadingIcon,
  trailing,
  className = '',
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const id = props.name ? `${props.name}-${generatedId}` : generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <span className={`input-wrap ${leadingIcon ? 'has-leading' : ''} ${trailing ? 'has-trailing' : ''}`}>
        {leadingIcon && (
          <span className="input-leading" aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        <input
          id={id}
          className={`input ${className}`.trim()}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {trailing && <span className="input-trailing">{trailing}</span>}
      </span>
    </FieldShell>
  );
}

export function PasswordField({
  label,
  error,
  hint,
  optional,
  ...props
}: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          className="field-action"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
        </button>
      }
      {...props}
    />
  );
}

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'id'> {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}

export function SelectField({
  label,
  error,
  hint,
  optional,
  className = '',
  children,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const id = props.name ? `${props.name}-${generatedId}` : generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <span className="select-wrap">
        <select
          id={id}
          className={`input select ${className}`.trim()}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        >
          {children}
        </select>
        <CaretDown className="select-caret" size={16} aria-hidden="true" />
      </span>
    </FieldShell>
  );
}

export interface TextareaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
}

export function TextareaField({
  label,
  error,
  hint,
  optional,
  className = '',
  ...props
}: TextareaFieldProps) {
  const generatedId = useId();
  const id = props.name ? `${props.name}-${generatedId}` : generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <textarea
        id={id}
        className={`input textarea ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ badges */

const STATUS_META: Record<UserStatus, { label: string; tone: string }> = {
  PENDING_APPROVAL: { label: 'Awaiting review', tone: 'pending' },
  ACTIVE: { label: 'Active', tone: 'active' },
  REJECTED: { label: 'Rejected', tone: 'rejected' },
  SUSPENDED: { label: 'Suspended', tone: 'suspended' },
};

export function StatusBadge({ status }: { status: UserStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`status-badge status-${meta.tone}`} data-status={status}>
      <span className="status-dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export const ROLE_SHORT_LABELS: Record<RoleName, string> = {
  STUDENT: 'Student',
  FACULTY: 'Faculty',
  HOD: 'HOD',
  BURSAR: 'Bursar',
  PRINCIPAL: 'Principal',
  ADMINISTRATOR: 'Administrator',
};

export function RoleBadge({ role }: { role: RoleName }) {
  return <span className={`role-badge role-${role.toLowerCase()}`}>{ROLE_SHORT_LABELS[role]}</span>;
}

/* ------------------------------------------------------------------ avatar */

const AVATAR_TONES = 5;

function initials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function avatarTone(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return (hash % AVATAR_TONES) + 1;
}

export function Avatar({
  firstName,
  lastName,
  size = 'md',
}: {
  firstName: string;
  lastName: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <span
      className={`avatar avatar-${size} avatar-tone-${avatarTone(`${firstName}${lastName}`)}`}
      aria-hidden="true"
    >
      {initials(firstName, lastName)}
    </span>
  );
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const Icon =
    tone === 'success' ? CheckCircle : tone === 'info' ? Info : WarningCircle;
  return (
    <div
      className={`alert alert-${tone}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <Icon size={20} className="alert-icon" aria-hidden="true" />
      <div>
        {title && <strong className="alert-title">{title}</strong>}
        <div className="alert-body">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dialog */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p id={descriptionId} className="dialog-description">
              {description}
            </p>
          )}
        </div>
        <IconButton label="Close dialog" onClick={onClose} className="dialog-close">
          <X size={18} />
        </IconButton>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </dialog>
  );
}

/* ------------------------------------------------------------------ toasts */

type ToastTone = 'success' | 'danger' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = ++nextId.current;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), 5000),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div className="toast-region" aria-label="Notifications">
        {toasts.map((toast) => {
          const Icon =
            toast.tone === 'success' ? CheckCircle : toast.tone === 'danger' ? WarningCircle : Info;
          return (
            <div className={`toast toast-${toast.tone}`} role="status" key={toast.id}>
              <Icon size={20} className="toast-icon" aria-hidden="true" />
              <div className="toast-copy">
                <strong>{toast.title}</strong>
                {toast.message && <p>{toast.message}</p>}
              </div>
              <IconButton label="Dismiss notification" onClick={() => dismiss(toast.id)}>
                <X size={15} />
              </IconButton>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider.');
  return context;
}

/* ------------------------------------------------------------------ roles */

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  STUDENT: 'Creates and tracks personal venue requests.',
  FACULTY: 'Creates requests on behalf of an academic department.',
  HOD: 'Reviews and endorses requests from their own department.',
  BURSAR: 'Provides the financial review for event requests.',
  PRINCIPAL: 'Gives final approval and allots venues.',
  ADMINISTRATOR: 'Manages accounts, access and institutional configuration.',
};

export function RoleOption({
  role,
  checked,
  departmentCode,
  disabled,
  onChange,
}: {
  role: RoleName;
  checked: boolean;
  departmentCode: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`role-option ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="role-option-check" aria-hidden="true">
        {checked && <CheckCircle size={16} weight="fill" />}
      </span>
      <span className="role-option-copy">
        <span className="role-option-title">
          {ROLE_LABELS[role]}
          <span className="role-option-scope">
            {DEPARTMENT_SCOPED_ROLES.includes(role) ? departmentCode : 'College-wide'}
          </span>
        </span>
        <span className="role-option-description">{ROLE_DESCRIPTIONS[role]}</span>
      </span>
    </label>
  );
}
