// ==UserScript==
// @name         Trailer move restriction (improved)
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Restrict moving Double Decker trailers to small bay doors (optimized + reliable)
// @author       Valdemar Iliev (valdemai) + improvements
// @match        https://trans-logistics-eu.amazon.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/thecrought/trailermove/main/TrailerRestriction.user.js
// @updateURL    https://raw.githubusercontent.com/thecrought/trailermove/main/TrailerRestriction.user.js
// ==/UserScript==

(function () {
  'use strict';

  // =========================
  // CONFIG
  // =========================
  const DEBUG = true;

  // Only run on the yard view (SPA hash routing)
  const YARD_HASH = '#/yard';

  const DOUBLE_DECKER_MARKER_TEXT = 'Double Decker Trailer';

  // Prefer values if available; otherwise normalize text
  const RESTRICTED_BAYS = new Set(['DD14SD', 'DD19SD', 'DD20SD', 'DD21SD', 'DD22SD']);

  const SAVE_LABEL = 'Save';
  const BLOCKED_LABEL = 'DO NOT MOVE';

  const BLOCKED_CLASS = 'tm-dd-blocked-save';

  // =========================
  // UTIL
  // =========================
  const log = (...args) => DEBUG && console.log('[TM Trailer Restriction]', ...args);

  function isOnYardPage() {
    return String(location.hash || '').includes(YARD_HASH);
  }

  function injectStyleOnce() {
    if (document.getElementById('tm-dd-style')) return;
    const style = document.createElement('style');
    style.id = 'tm-dd-style';
    style.textContent = `
      .${BLOCKED_CLASS} {
        background: red !important;
        color: white !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Normalizes a destination option like:
  // "DD14", "DD14 - Door 14", "DD14  Door 14" -> "DD14"
  function normalizeBay(str) {
    if (!str) return '';
    const s = String(str).trim();
    // First token up to whitespace or hyphen
    const token = s.split(/\s|-+/)[0];
    return token.trim().toUpperCase();
  }

  function findLikelyDialogRoot(node) {
    // Try to locate the nearest modal/dialog container from a node.
    // These selectors are intentionally broad because apps vary.
    return (
      node.closest?.('[role="dialog"]') ||
      node.closest?.('.modal, .modal-dialog, .modal-content, .dialog, .popup') ||
      null
    );
  }

  function findActiveMovementDialog() {
    // Broad search for a visible dialog container that contains destination select
    const candidates = Array.from(
      document.querySelectorAll('[role="dialog"], .modal, .modal-dialog, .modal-content, .dialog, .popup')
    );

    for (const el of candidates) {
      // Must contain destination select we care about
      const destination = el.querySelector('select[ng-model="destination"]');
      if (!destination) continue;

      // If element is not connected/visible-ish, skip
      if (!el.isConnected) continue;

      return el;
    }
    return null;
  }

  function getSaveButton(dialogRoot) {
    const buttons = Array.from(dialogRoot.querySelectorAll('button'));
    // Prefer exact-ish match, case-insensitive
    return (
      buttons.find(b => (b.textContent || '').trim().toLowerCase() === SAVE_LABEL.toLowerCase()) ||
      // fallback: contains "save"
      buttons.find(b => (b.textContent || '').trim().toLowerCase().includes('save')) ||
      null
    );
  }

  function storeOriginalButtonState(btn) {
    if (!btn || btn.dataset.tmStored === '1') return;
    btn.dataset.tmStored = '1';
    btn.dataset.tmOrigText = (btn.textContent || '').trim();
    btn.dataset.tmOrigDisabled = btn.disabled ? '1' : '0';
    btn.dataset.tmOrigClass = btn.className || '';
  }

  function restoreButton(btn) {
    if (!btn) return;

    // Restore disabled + label if we stored it, else do safe defaults
    const origText = btn.dataset.tmOrigText || SAVE_LABEL;
    const origDisabled = btn.dataset.tmOrigDisabled === '1';
    const origClass = btn.dataset.tmOrigClass || btn.className;

    btn.disabled = origDisabled;
    btn.textContent = origText;

    // Remove our class (don’t wipe app styling)
    btn.classList.remove(BLOCKED_CLASS);

    // Restore className only if we previously stored it
    // (If app dynamically changes className after storing, restoring could be worse.
    // So we do NOT force className back. We only remove ours.)
    // btn.className = origClass; // intentionally not forcing
  }

  function blockButton(btn) {
    if (!btn) return;
    storeOriginalButtonState(btn);

    btn.disabled = true;
    btn.textContent = BLOCKED_LABEL;
    btn.classList.add(BLOCKED_CLASS);
  }

  function isDoubleDecker(dialogRoot) {
    if (!dialogRoot) return false;
    // IMPORTANT: only check within the dialog to avoid scanning the whole page
    const text = dialogRoot.innerText || dialogRoot.textContent || '';
    return text.includes(DOUBLE_DECKER_MARKER_TEXT);
  }

  function getSelectedBay(destinationSelect) {
    if (!destinationSelect) return '';

    const opt = destinationSelect.options?.[destinationSelect.selectedIndex];
    // Prefer option value if it looks like DDxx
    const val = normalizeBay(opt?.value || '');
    if (val) return val;

    // Otherwise use visible text
    const txt = normalizeBay(opt?.textContent || destinationSelect.value || '');
    return txt;
  }

  // =========================
  // CREDITS INJECTION (your existing logic, SPA-friendly)
  // =========================
  function createCreditsDiv() {
    const creditsDiv = document.createElement('div');
    creditsDiv.innerHTML =
      'Improved YMS Script by <span style="font-weight: bold;"><a href="https://fclm-portal.amazon.com/employee/timeDetails?warehouseId=LCY2&employeeId=102679647" style="color: black; text-decoration: underline; font-weight: bold;">Valdemar Iliev (valdemai) v1.0.0</a></span>';
    creditsDiv.style.display = 'inline-block';
    creditsDiv.style.marginLeft = '10px';
    creditsDiv.style.color = 'black';
    creditsDiv.style.fontSize = '12px';
    creditsDiv.style.padding = '2px 5px';
    creditsDiv.style.borderRadius = '3px';
    creditsDiv.style.opacity = '0.9';
    creditsDiv.id = 'custom-credits-div';
    return creditsDiv;
  }

  function injectCredits() {
    if (!isOnYardPage()) return;

    const titleHeader = document.querySelector('h1#title');
    if (!titleHeader) return;

    const yardManagementTag = titleHeader.querySelector('t');
    if (!yardManagementTag) return;

    if (!yardManagementTag.querySelector('#custom-credits-div')) {
      yardManagementTag.appendChild(createCreditsDiv());
      log('Credits injected.');
    }
  }

  // Re-inject credits on SPA changes
  const creditsObserver = new MutationObserver(() => injectCredits());

  function startCreditsObserving() {
    const titleHeader = document.querySelector('h1#title');
    if (titleHeader) {
      creditsObserver.observe(titleHeader, { childList: true, subtree: true });
      injectCredits();
      log('Credits observer started.');
    } else {
      setTimeout(startCreditsObserving, 500);
    }
  }

  // =========================
  // MOVEMENT RESTRICTION LOGIC
  // =========================
  function bindRestrictionToDialog(dialogRoot) {
    if (!dialogRoot || dialogRoot.dataset.tmDdBound === '1') return;

    const destinationSelect = dialogRoot.querySelector('select[ng-model="destination"]');
    const saveButton = getSaveButton(dialogRoot);

    if (!destinationSelect || !saveButton) return;

    dialogRoot.dataset.tmDdBound = '1';
    storeOriginalButtonState(saveButton);

    const applyRules = () => {
      // Always decide final state; do not leave stale “blocked” status around
      const dd = isDoubleDecker(dialogRoot);
      const bay = getSelectedBay(destinationSelect);
      const restricted = RESTRICTED_BAYS.has(bay);

      log('applyRules()', { dd, bay, restricted });

      if (dd && restricted) {
        blockButton(saveButton);
      } else {
        restoreButton(saveButton);
      }
    };

    destinationSelect.addEventListener('change', applyRules);

    // Apply immediately (critical improvement)
    applyRules();

    log('Restriction bound to dialog.');
  }

  // Observe DOM for dialogs appearing (no polling)
  const dialogObserver = new MutationObserver((mutations) => {
    if (!isOnYardPage()) return;

    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;

        // If a dialog was added, bind
        const dialogRoot = findLikelyDialogRoot(added) || (added.matches?.('[role="dialog"], .modal, .modal-dialog, .modal-content, .dialog, .popup') ? added : null);
        if (dialogRoot) bindRestrictionToDialog(dialogRoot);

        // Also handle case where dialog already exists but destination select got injected later
        const activeDialog = findActiveMovementDialog();
        if (activeDialog) bindRestrictionToDialog(activeDialog);
      }
    }
  });

  // Optional: also trigger binding after clicking "request movement" button,
  // but we still rely on observer for reliability.
  document.body.addEventListener('click', (event) => {
    if (!isOnYardPage()) return;
    const target = event.target;
    if (target && target.matches && target.matches('.request-movement.highlight')) {
      log('Movement button clicked.');
      const activeDialog = findActiveMovementDialog();
      if (activeDialog) bindRestrictionToDialog(activeDialog);
    }
  });

  // =========================
  // INIT
  // =========================
  injectStyleOnce();
  startCreditsObserving();

  dialogObserver.observe(document.body, { childList: true, subtree: true });
  log('Dialog observer started. Script active.');
})();
