export type NotifyType = 'success' | 'error' | 'warning' | 'info';

export interface NotifyOptions {
  message: string;
  type?: NotifyType;
  // Kept for call-site compatibility with the devextreme/ui/notify options
  // this replaces - every real caller always passed 'top' (or omitted it),
  // and a toast is low-visibility enough that a single fixed position
  // (top-center) isn't worth a real positioning system for.
  position?: string;
}

const COLORS: Record<NotifyType, string> = {
  success: '#5cb85c',
  error: '#d9534f',
  warning: '#f0ad4e',
  info: '#337ab7'
};

const DEFAULT_DURATIONS: Record<NotifyType, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000
};

let container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) {
    return container;
  }

  container = document.createElement('div');
  container.style.cssText = [
    'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:100000', 'display:flex', 'flex-direction:column', 'align-items:center',
    'gap:8px', 'pointer-events:none'
  ].join(';');
  document.body.appendChild(container);

  return container;
}

/**
 * Self-contained replacement for devextreme/ui/notify's notify() - a
 * dependency-free toast styled entirely with inline CSS (no stylesheet,
 * no UI framework), so it renders identically in every app that depends
 * on this submodule regardless of what that app is built with. Supports
 * both call shapes the code it replaces used: the object form
 * notify({message, type, position}), and the positional form
 * notify(message, type, duration).
 */
export function notify(options: NotifyOptions | string, type: NotifyType = 'info', duration?: number): void {
  const message = typeof options === 'string' ? options : options.message;
  const resolvedType = typeof options === 'string' ? type : (options.type ?? 'info');
  const resolvedDuration = duration ?? DEFAULT_DURATIONS[resolvedType];

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    `background:${COLORS[resolvedType]}`, 'color:#fff', 'padding:10px 16px',
    'border-radius:4px', 'font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
    'box-shadow:0 2px 8px rgba(0,0,0,.2)', 'max-width:420px', 'text-align:center',
    'pointer-events:auto', 'opacity:0', 'transition:opacity .2s ease'
  ].join(';');

  getContainer().appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, resolvedDuration);
}
