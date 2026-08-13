import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { borderStyle, subtleControlStyle } from "./tokens";

/** A label stacked above its control. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      {children}
    </div>
  );
}

const CONTROL = "w-full px-3 py-2 border rounded";

/** Full-width form input, as used by the admin forms. */
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL} style={borderStyle} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={CONTROL} style={borderStyle} />;
}

/**
 * The kiosk/trainer control style. `className` is required because the two
 * screens size these differently.
 */
export function SubtleInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { className: string }) {
  return <input {...props} className={className} style={subtleControlStyle} />;
}

/** A small secondary button on the kiosk and trainer screens. */
export function SubtleButton({
  color: textColor,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: string;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      className="btn btn-sm"
      style={textColor ? { ...subtleControlStyle, color: textColor } : subtleControlStyle}
    >
      {children}
    </button>
  );
}
