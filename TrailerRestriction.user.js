// ==UserScript==
// @name         Trailer move restriction (fast + safe)
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Restrict moving Double Decker trailers to small bay doors (optimized to avoid Firefox overload)
// @author       Valdemar Iliev (valdemai)
// @match        https://trans-logistics-eu.amazon.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/thecrought/trailermove/main/TrailerRestriction.user.js
// @updateURL    https://raw.githubusercontent.com/thecrought/trailermove/main/TrailerRestriction.user.js
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
    style.textContent = `
      .${BLOCKED_CLASS} { background: red !important; color: white !important; }
    `;
    document.head.appendChild(style);
  }

  function normalizeBay(str) {
    if (!str) return '';
    const s = String(str).trim();
    const token = s.split(/\s|-+/)[0];
    return token.trim().toUpperCase();
  }

  function getSelectedBay(selectEl) {
    if (!selectEl) return '';
    const opt = selectEl.options?.[selectEl.selectedIndex];
    const v = normalizeBay(opt?.value || '');
    if (v) return v;
    return normalizeBay(opt?.textContent || selectEl.value || '');
  }

  function findMovementDialogRoot() {
    // Look for a dialog/modal that contains the destination select
    const containers = document.querySelectorAll('[role="dialog"], .modal, .modal-dialog, .modal-content, .dialog, .popup');
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

  // --- Credits injection (kept lightweight)
  function createCreditsDiv() {
    const creditsDiv = document.createElement('div');
    creditsDiv.innerHTML =
      'Improved YMS Script by <span style="font-weight: bold;"><a href="https://fclm-portal.amazon.com/employee/timeDetails?warehouseId=LCY2&employeeId=102679647" style="color: black; text-decoration: underline; font-weight: bold;">Valdemar Iliev (valdemai) v1.1.0</a></span>';
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

  function injectCreditsOnceWhenAvailable() {
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

  // Try a few times instead of observing entire DOM
  function creditsRetryLoop(attempts = 20) {
    if (attempts <= 0) return;
    injectCreditsOnceWhenAvailable();
    if (document.querySelector('#custom-credits-div')) return;
    setTimeout(() => creditsRetryLoop(attempts - 1), 500);
  }

  // --- Core: bind restrictions to the modal (no global observer)
  function bindRestrictions(dialogRoot) {
    if (!dialogRoot || dialogRoot.dataset.tmDdBound === '1') return;

    const destinationSelect = dialogRoot.querySelector('select[ng-model="destination"]');
    const saveButton = getSaveButton(dialogRoot);
    if (!destinationSelect || !saveButton) return;

    dialogRoot.dataset.tmDdBound = '1';
    storeOriginal(saveButton);

    // Cache “is double decker” ONCE per modal open
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

  // Start watching only after clicking request movement, and stop quickly
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
      // Debounce bursts of mutations into one check
      setTimeout(check, 50);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also do an immediate check (sometimes modal is already in DOM)
    check();

    // Safety: stop after 5 seconds even if modal not found
    const timeoutId = setTimeout(stop, 5000);
  }

  // Hook only the movement button click
  document.body.addEventListener('click', (event) => {
    if (!isOnYardPage()) return;

    const target = event.target;
    if (target && target.matches && target.matches('.request-movement.highlight')) {
      log('Movement clicked; watching for dialog...');
      watchForDialogOnce();
    }
  });

  // Init
  injectStyleOnce();
  creditsRetryLoop();
})();
