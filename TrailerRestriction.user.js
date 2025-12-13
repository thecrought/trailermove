// ==UserScript==
// @name         Trailer move restriction (fast + prefix bays + reliable DD detect)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Restrict moving Double Decker (VD) trailers to small bay doors (fast + stable)
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

  // Trailer type markers (add more here if your UI uses different wording)
  const TRAILER_TYPE_MARKERS = [
    'Double Decker Trailer',
    'Double Decker',
    'VD Trailer',
    'VD trailer',
    'VD'
  ];

  // Restrict any destination that STARTS with these (e.g., DD19, DD19SD, DD19-XX, DD19 something)
  const RESTRICTED_BAY_PREFIXES = ['DD14', 'DD19', 'DD20', 'DD21', 'DD22'];

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
      'Improved YMS Script by <span style="font-weight:bold;"><a href="https://fclm-portal.amazon.com/employee/timeDetails?warehouseId=LCY2&employeeId=102679647" style="color:black;text-decoration:underline;font-weight:bold;">Valdemar Iliev (valdemai) v1.3.0</a></span>';
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
  // RESTRICTION
  // =========================
  function normalizeBay(str) {
    if (!str) return '';
    return String(str).trim().toUpperCase().replace(/\s+/g, '');
  }

  // Extract a “code-like” prefix from common formats:
  // "DD19SD", "DD19-SD", "DD19 SD", "DD19SD - Door" -> "DD19SD" (no spaces)
  function getSelectedBay(selectEl) {
    const opt = selectEl?.options?.[selectEl.selectedIndex];
    const raw = (opt?.value || opt?.textContent || selectEl?.value || '').trim();
    if (!raw) return '';

    // take left side of " - " if present
    const left = raw.split(' - ')[0];
    // remove spaces; keep hyphen removal too (so DD19-SD => DD19SD)
    return normalizeBay(left).replace(/-/g, '');
  }

  function isRestrictedBay(bayCode) {
    if (!bayCode) return false;
    // Ensure we compare without hyphens/spaces
    const code = normalizeBay(bayCode).replace(/-/g, '');
    return RESTRICTED_BAY_PREFIXES.some(prefix => code.startsWith(prefix));
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

  function textContainsMarker(txt) {
    if (!txt) return false;
    return TRAILER_TYPE_MARKERS.some(m => txt.includes(m));
  }

  function bindRestrictions(dialogRoot) {
    if (!dialogRoot || dialogRoot.dataset.tmDdBound === '1') return;

    const destinationSelect = dialogRoot.querySelector('select[ng-model="destination"]');
    const saveButton = getSaveButton(dialogRoot);
    if (!destinationSelect || !saveButton) return;

    dialogRoot.dataset.tmDdBound = '1';
    storeOriginal(saveButton);

    // Detect trailer type:
    // 1) Try inside dialog (cheap)
    // 2) If not found, fallback to a one-time whole-page check (still only once per popup)
    const dialogText = dialogRoot.innerText || dialogRoot.textContent || '';
    let isDD = textContainsMarker(dialogText);

    if (!isDD) {
      const pageText = document.body?.innerText || '';
      isDD = textContainsMarker(pageText);
    }

    log('Trailer type detected as DD/VD:', isDD);

    const applyRules = () => {
      const bay = getSelectedBay(destinationSelect);
      const restricted = isRestrictedBay(bay);

      log('applyRules', { isDD, bay, restricted });

      if (isDD && restricted) block(saveButton);
      else restore(saveButton);
    };

    destinationSelect.addEventListener('change', applyRules);
    applyRules(); // apply immediately
  }

  function watchForDialogOnce() {
    let stopped = false;
    let scheduled = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      clearTimeout(timeoutId);
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
      setTimeout(check, 50);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    check();
    const timeoutId = setTimeout(stop, 7000);
  }

  // IMPORTANT: closest() so clicks on icon/span inside the button count
  document.body.addEventListener('click', (event) => {
    if (!isOnYardPage()) return;
    const btn = event.target?.closest?.('.request-movement.highlight');
    if (btn) watchForDialogOnce();
  });

  // INIT
  injectStyleOnce();
  startCreditsObserver();
  injectCredits();

})();
