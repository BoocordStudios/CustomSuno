import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './bridge';

let layoutQueue = Promise.resolve();
function reservePanel(open: boolean) {
  layoutQueue = layoutQueue.catch(() => {}).then(async () => {
    if (desktop) await invoke('set_panel', { open });
  });
  return layoutQueue;
}

export function useDrawerMotion<T extends string>(panel: T | null, reduceMotion: boolean, onError: (error: unknown) => void) {
  const [retained, setRetained] = useState(panel);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const drawerRef = useRef<HTMLElement>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const open = panel !== null;
  const reduced = reduceMotion || systemReduced;

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => { if (panel !== null) setRetained(panel); }, [panel]);
  useLayoutEffect(() => {
    const element = drawerRef.current;
    let cancelled = false;
    let animation: Animation | undefined;
    // Keep the last content mounted until the native webview can expand again.
    if (!element) {
      void reservePanel(false).catch(error => errorRef.current(error));
      return;
    }
    element.toggleAttribute('inert', !open);
    const animate = async () => {
      if (open) await reservePanel(true);
      if (cancelled) return;
      const current = getComputedStyle(element);
      animation = element.animate([
        { transform: current.transform, opacity: current.opacity },
        { transform: open ? 'translateX(0)' : 'translateX(100%)', opacity: open ? 1 : 0 },
      ], { duration: reduced ? 0 : 240, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' });
      await animation.finished;
      if (!open && !cancelled) {
        await reservePanel(false);
        if (!cancelled) setRetained(null);
      }
    };
    void animate().catch(error => { if (!cancelled) errorRef.current(error); });
    return () => {
      cancelled = true;
      if (animation) {
        // Reverse rapid clicks from the current position instead of jumping.
        if (element.isConnected) animation.commitStyles();
        animation.cancel();
      }
    };
  }, [open, reduced]);

  return { displayedPanel: panel ?? retained, drawerRef, reduced };
}
