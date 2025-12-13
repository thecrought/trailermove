// ==UserScript==
// @name         Trailer move restriction (fast + stable)
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Restrict moving Double Decker trailers to small bay doors (optimized + stable on SPA re-renders)
// @author       Valdemar Iliev (valdemai)
// @match        https://trans-logistics-eu.amazon.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[TM Restrict]', ...a);

  const YARD_HASH = '#/yard';
  const DOUBLE_DECKER_MARKER_TEXT = 'Double Decker Trailer';
  const RESTRICTED_BAYS = new Set(['DD14', 'DD19', 'DD20', 'DD21', 'DD22']);

  const SAVE_LABEL = 'Save';
  const BLOCKED_LABEL = 'DO NOT MOVE';
  const BLOCKED_CLASS = 'tm-dd-blocked-save';

  function isOnYardPage() {
    return String(location.hash || '').includes(YARD_HASH);
  }

  function injectStyleOnce() {
    if (document.getElementById('tm-dd-style')) return;
    const style = document.createElement('style');
    style.id = 'tm-dd-style';
    style.textContent = `.${BLOCKED_CLASS}{background:red!important;color:white!important;}`;
    document.head.appendChild(style);
  }

  // =========================
  // CREDITS (stable)
  // =========================
  function createCreditsDiv() {
    const creditsDiv = document.createElement('div');
    creditsDiv.id = 'custom-credits-div';
    creditsDiv.innerHTML =
      'Improved YMS Script by <span style="font-weight:bold;"><a href="https://fclm-portal.amazon.com/employee/timeDetails?warehouseId=LCY2&employeeId=102679647" style="color:black;text-decoration:underline;font-weight:bold;">Valdemar Iliev (valdemai) v1.2.0</a></span>';
    creditsDiv.style.display = 'inline-block';
    creditsDiv.style.marginLeft = '10px';
    creditsDiv.style.color = 'black';
    creditsDiv.style.fontSize = '12px';
    creditsDiv.style.padding = '2px 5px';
    creditsDiv.style.borderRadius = '3px';
    creditsDiv.style.opacity = '0.9';
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

  // Observe ONLY the title area (tiny, safe), so credits reappear after re-render
  function startCreditsObserver() {
    const tryStart = () => {
      const titleHeader = document.querySelector('h1#title');
      if (!titleHeader) return setTimeout(tryStart, 500);

      const obs = new MutationObserver(() => injectCredits());
      obs.observe(titleHeader, { childList: true, subtree: true });
      injectCredits();
      log('Credits observer started on h1#title.');
    };
    tryStart();
  }

  // =========================
  // RESTRICTION (stable)
  // =========================
  function normalizeBay(str) {
    if (!str) return '';
    const s = String(str).trim();
    const token = s.split(/\s|-+/)[0];
    return token.trim().toUpperCase();
  }

  function getSelectedBay(selectEl) {
    const opt = selectEl?.options?.[selectEl.selectedIndex];
    const fromValue = normalizeBay(opt?.value || '');
    if (fromValue) return fromValue;
    return normalizeBay(opt?.textContent || selectEl.value || '');
  }

  function findMovementDialogRoot() {
    const containers = document.querySelectorAll(
      '[role="dialog"], .modal, .modal-dialog, .modal-content, .dialog, .popup'
    );
    for (const el of containers) {
      if (el.querySelector('select[ng-model="destination"]')) return el;
    }
    return null;
  }

  function getSaveButton(dialogRoot) {
    const buttons = Array.from(dialogRoot.querySelectorAll('button'));
    return (
      buttons.find(b => (b.textContent || '').trim().toLowerCase() === SAVE_LABEL.toLowerCase()) ||
      buttons.find(b => (b.textContent || '').trim().toLowerCase().includes('save')) ||
      null
    );
  }

  function storeOriginal(btn) {
    if (!btn || btn.dataset.tmStored === '1') return;
    btn.dataset.tmStored = '1';
    btn.dataset.tmOrigText = (btn.textContent || '').trim();
    btn.dataset.tmOrigDisabled = btn.disabled ? '1' : '0';
  }

  function restore(btn) {
    if (!btn) return;
    btn.disabled = btn.dataset.tmOrigDisabled === '1';
    btn.textContent = btn.dataset.tmOrigText || SAVE_LABEL;
    btn.classList.remove(BLOCKED_CLASS);
  }

  function block(btn) {
    if (!btn) return;
    storeOriginal(btn);
    btn.disabled = true;
    btn.textContent = BLOCKED_LABEL;
    btn.classList.add(BLOCKED_CLASS);
  }

  function bindRestrictions(dialogRoot) {
    if (!dialogRoot || dialogRoot.dataset.tmDdBound === '1') return;

    const destinationSelect = dialogRoot.querySelector('select[ng-model="destination"]');
    const saveButton = getSaveButton(dialogRoot);
    if (!destinationSelect || !saveButton) return;

    dialogRoot.dataset.tmDdBound = '1';
    storeOriginal(saveButton);

    // Cache trailer type ONCE per modal instance
    const dd = (dialogRoot.innerText || dialogRoot.textContent || '').includes(DOUBLE_DECKER_MARKER_TEXT);

    const applyRules = () => {
      const bay = getSelectedBay(destinationSelect);
      const restricted = RESTRICTED_BAYS.has(bay);
      log('applyRules', { dd, bay, restricted });

      if (dd && restricted) block(saveButton);
      else restore(saveButton);
    };

    destinationSelect.addEventListener('change', applyRules);
    applyRules(); // apply immediately
    log('Restrictions bound.');
  }

  // Watch for the dialog ONLY after click, stop quickly
  function watchForDialogOnce() {
    let stopped = false;
    let scheduled = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      log('Dialog watcher stopped.');
    };

    const check = () => {
      if (stopped) return;
      scheduled = false;
      const dialog = findMovementDialogRoot();
      if (dialog) {
        bindRestrictions(dialog);
        stop();
      }
    };

    const observer = new MutationObserver(() => {
      if (stopped || scheduled) return;
      scheduled = true;
      setTimeout(check, 50); // debounce
    });

    observer.observe(document.body, { childList: true, subtree: true });
    check(); // immediate attempt
    const timeoutId = setTimeout(stop, 6000); // safety stop
  }

  // IMPORTANT FIX: use closest() so clicks on inner elements still count
  document.body.addEventListener('click', (event) => {
    if (!isOnYardPage()) return;

    const btn = event.target?.closest?.('.request-movement.highlight');
    if (btn) {
      log('Movement clicked; watching for dialog...');
      watchForDialogOnce();
    }
  });

  // =========================
  // INIT
  // =========================
  injectStyleOnce();
  startCreditsObserver();
  injectCredits();

})();
