import { useEffect, type RefObject } from "react";

/** Focus containment, Escape, scroll locking, and focus restoration for overlays. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, mobileOnly = false) {
  useEffect(() => {
    if (!open || (mobileOnly && window.matchMedia("(min-width: 1024px)").matches)) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldRole = dialog.getAttribute("role");
    const oldModal = dialog.getAttribute("aria-modal");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const background: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.setAttribute("inert", "");
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (mobileOnly && desktop.matches) onClose(); };
    desktop.addEventListener("change", onResize);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    (focusable()[0] || dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      desktop.removeEventListener("change", onResize);
      background.forEach(({ element, inert }) => { element.toggleAttribute("inert", inert); });
      if (oldRole === null) dialog.removeAttribute("role"); else dialog.setAttribute("role", oldRole);
      if (oldModal === null) dialog.removeAttribute("aria-modal"); else dialog.setAttribute("aria-modal", oldModal);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, open, onClose, mobileOnly]);
}
