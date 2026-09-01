import { forwardRef, useId } from 'react';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

const fieldBase =
  'w-full rounded-xl border bg-surface-raised px-3 text-sm text-content placeholder:text-content-faint ' +
  'transition focus:border-accent focus:outline-none focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50';

/** Enveloppe commune : label en petites capitales, aide, message d'erreur. */
export function Field({ label, htmlFor, hint, error, required, className, children }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium uppercase tracking-wide text-content-muted"
        >
          {label}
          {required && <span className="ml-1 text-danger">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-content-faint">{hint}</p>}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle size={13} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Une valeur absente devient la chaîne vide.
 *
 * React refuse `null` sur un champ contrôlé — « `value` prop on `select`
 * should not be null » — et l'avertissement s'imprimait à chaque rendu de
 * l'écran des préférences : « bâtiment principal » vaut `null` tant que
 * personne n'en a choisi, et c'est bien ce qu'il faut renvoyer au serveur.
 *
 * La normalisation vit donc ici et non chez l'appelant. Chaque écran qui
 * affiche une préférence non renseignée retomberait sinon dans le même piège.
 *
 * `undefined` passe intact : c'est ainsi qu'on demande un champ non contrôlé,
 * et le confondre avec `null` retirerait ce choix aux appelants.
 */
const valeurControlee = (valeur) => (valeur === null ? '' : valeur);

export const Input = forwardRef(function Input(
  { label, hint, error, required, icon: Icon, className, id, value, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          className={cn(fieldBase, 'h-10', Icon && 'pl-9', error ? 'border-danger' : 'border-line', className)}
          value={valeurControlee(value)}
          {...props}
        />
      </div>
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, hint, error, required, className, id, rows = 4, value, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        required={required}
        aria-invalid={Boolean(error) || undefined}
        className={cn(fieldBase, 'py-2.5 leading-relaxed', error ? 'border-danger' : 'border-line', className)}
        value={valeurControlee(value)}
        {...props}
      />
    </Field>
  );
});

export const Select = forwardRef(function Select(
  { label, hint, error, required, options = [], placeholder, className, id, value, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} required={required}>
      <div className="relative">
        <select
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          className={cn(
            fieldBase,
            'h-10 appearance-none pr-9',
            error ? 'border-danger' : 'border-line',
            className,
          )}
          value={valeurControlee(value)}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value ?? option.id} value={option.value ?? option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted"
        />
      </div>
    </Field>
  );
});

export function Checkbox({ label, description, checked, onChange, id, className, ...props }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          id={inputId}
          checked={checked}
          onChange={(event) => onChange?.(event.target.checked)}
          className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-line-strong bg-surface-raised
                     transition checked:border-accent checked:bg-accent"
          {...props}
        />
        <Check
          size={11}
          strokeWidth={3}
          aria-hidden="true"
          className="pointer-events-none absolute text-white opacity-0 transition peer-checked:opacity-100"
        />
      </span>
      <label htmlFor={inputId} className="cursor-pointer text-sm leading-tight text-content">
        {label}
        {description && <span className="mt-0.5 block text-xs text-content-muted">{description}</span>}
      </label>
    </div>
  );
}

/**
 * `hideLabel` masque le libellé à l'écran sans le retirer aux lecteurs
 * d'écran : utile quand le contexte de la ligne le rend déjà évident.
 */
export function Switch({ label, description, checked, onChange, id, icon: Icon, hideLabel = false }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex items-center justify-between gap-4">
      <label
        htmlFor={inputId}
        className={cn('flex cursor-pointer items-start gap-3', hideLabel && 'sr-only')}
      >
        {Icon && <Icon size={16} aria-hidden="true" className="mt-0.5 text-content-muted" />}
        <span>
          <span className="block text-sm text-content">{label}</span>
          {description && <span className="block text-xs text-content-muted">{description}</span>}
        </span>
      </label>
      <button
        type="button"
        role="switch"
        id={inputId}
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange?.(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-raised',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}
