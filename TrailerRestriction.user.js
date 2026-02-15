// ==UserScript==
// @name         Trailer move restriction (DEBUG) - VD DoubleDeck
// @namespace    http://tampermonkey.net/
// @version      1.6.0-debug
// @description  Blocks moving VD* Double Deck trailers to restricted bays
// @author       Valdemar Iliev (valdemai)
// @match        https://trans-logistics-eu.amazon.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* =========================
     DEBUG
  ========================= */
  const DEBUG = true;
  const log = (...a) => console.log('%c[TM DEBUG]', 'color:#b000ff;font-weight:bold;', ...a);

/* =========================
   CONFIG
========================= */
const YARD_HASH = '#/yard';

const TRAILER_TYPE_MARKERS = [
  'Double Deck Trailer',
  'Double Deck',
  'DoubleDeck'
];

// These exact bays are completely restricted
const RESTRICTED_BAYS = [
  'DD14SD',
  'DD19SD',
  'DD20SD',
  'DD21SD',
  'DD22SD'
];

// Only restrict trailers whose ID starts with this prefix
const TRAILER_ID_PREFIX = 'VD';

const SAVE_LABEL = 'Save';
const BLOCKED_LABEL = 'DO NOT MOVE';
const BLOCKED_CLASS = 'tm-dd-blocked-save';

  function isOnYardPage() {
    return String(location.hash || '').includes(YARD_HASH);
  }

  /* =========================
     STYLE
  ========================= */
  function injectStyleOnce() {
    if (document.getElementById('tm-dd-style')) return;
    const style = document.createElement('style');
    style.id = 'tm-dd-style';
    style.textContent = `.${BLOCKED_CLASS}{background:red!important;color:white!important;}`;
    document.head.appendChild(style);
  }

  /* =========================
     BAY PARSING
  ========================= */
  function normalize(str) {
    return String(str || '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/-/g, '');
  }

  function getSelectedBay(selectEl) {
    const opt = selectEl?.options?.[selectEl.selectedIndex];
    const raw = opt?.value || opt?.textContent || selectEl?.value || '';
    const cleaned = normalize(raw.split(' - ')[0]);
    log('Selected bay raw:', raw, '→ cleaned:', cleaned);
    return cleaned;
  }

  function isRestrictedBay(bay) {
    const result = RESTRICTED_BAYS.includes(bay);
      log('Is restricted bay?', bay, result);
      return result;
  }

  /* =========================
     DIALOG + BUTTON
  ========================= */
  function findMovementDialogRoot() {
    const dialogs = document.querySelectorAll(
      '[role="dialog"], .modal, .modal-dialog, .modal-content, .dialog, .popup'
    );

    for (const d of dialogs) {
      if (d.querySelector('select[ng-model="destination"]')) {
        log('Movement dialog found:', d);
        return d;
      }
    }

    log('Movement dialog NOT found yet');
    return null;
  }

  function getSaveButton(dialogRoot) {
    const buttons = Array.from(dialogRoot.querySelectorAll('button'));
    const btn = buttons.find(b =>
      (b.textContent || '').trim().toLowerCase().includes('save')
    );
    log('Save button:', btn);
    return btn;
  }

  function storeOriginal(btn) {
    if (!btn || btn.dataset.tmStored === '1') return;
    btn.dataset.tmStored = '1';
    btn.dataset.tmOrigText = btn.textContent;
    btn.dataset.tmOrigDisabled = btn.disabled ? '1' : '0';
  }

  function restore(btn) {
    log('Restoring Save button');
    btn.disabled = btn.dataset.tmOrigDisabled === '1';
    btn.textContent = btn.dataset.tmOrigText || SAVE_LABEL;
    btn.classList.remove(BLOCKED_CLASS);
  }

  function block(btn) {
    log('BLOCKING Save button');
    storeOriginal(btn);
    btn.disabled = true;
    btn.textContent = BLOCKED_LABEL;
    btn.classList.add(BLOCKED_CLASS);
  }

  /* =========================
     TRAILER TYPE DETECTION
  ========================= */
  function detectDoubleDeck(dialogRoot) {
    const dialogText = dialogRoot.innerText || '';
    log('Dialog text snippet:', dialogText.slice(0, 300));

    let found = TRAILER_TYPE_MARKERS.some(m => dialogText.includes(m));
    log('Double Deck detected in dialog?', found);

    if (!found) {
      const pageText = document.body.innerText || '';
      found = TRAILER_TYPE_MARKERS.some(m => pageText.includes(m));
      log('Fallback: Double Deck detected in PAGE?', found);
    }

    return found;
  }

  /* =========================
     TRAILER ID (VD*) DETECTION
  ========================= */
  function extractTrailerIdFromText(text) {
    const t = String(text || '');

    // Try a few common label formats first
    const labeledPatterns = [
      /Trailer\s*ID\s*[:#]?\s*([A-Z0-9-]+)/i,
      /Trailer\s*[:#]?\s*([A-Z0-9-]+)/i,
      /\bTrailer\s*Number\s*[:#]?\s*([A-Z0-9-]+)/i,
      /\bTrailer\s*:\s*([A-Z0-9-]+)/i,
      /\bEquipment\s*[:#]?\s*([A-Z0-9-]+)/i
    ];

    for (const re of labeledPatterns) {
      const m = t.match(re);
      if (m && m[1]) return normalize(m[1]);
    }

    // Fallback: find any token starting with VD (VD1234, VD-1234, etc.)
    const fallback = t.match(/\bVD[-\s]?[A-Z0-9]{2,}\b/i);
    if (fallback && fallback[0]) return normalize(fallback[0]);

    return '';
  }

  function detectTrailerStartsWithPrefix(dialogRoot, prefix) {
    const pfx = normalize(prefix);

    const dialogText = dialogRoot.innerText || '';
    let id = extractTrailerIdFromText(dialogText);

    log('Trailer ID from dialog:', id || '(none)');

    if (!id) {
      const pageText = document.body.innerText || '';
      id = extractTrailerIdFromText(pageText);
      log('Fallback Trailer ID from page:', id || '(none)');
    }

    const result = id.startsWith(pfx);
    log(`Trailer starts with ${pfx}?`, id || '(none)', result);
    return { result, id };
  }

  /* =========================
     CORE BINDING
  ========================= */
  function bindRestrictions(dialogRoot) {
    if (dialogRoot.dataset.tmBound === '1') {
      log('Dialog already bound, skipping');
      return;
    }

    dialogRoot.dataset.tmBound = '1';

    const destinationSelect = dialogRoot.querySelector('select[ng-model="destination"]');
    const saveButton = getSaveButton(dialogRoot);

    if (!destinationSelect || !saveButton) {
      log('Missing destination select or save button');
      return;
    }

    storeOriginal(saveButton);

    const applyRules = () => {
      log('--- applyRules triggered ---');

      const bay = getSelectedBay(destinationSelect);
      const restricted = isRestrictedBay(bay);

      // Re-detect each time in case popup content updates dynamically
      const isDoubleDeck = detectDoubleDeck(dialogRoot);
      const vdCheck = detectTrailerStartsWithPrefix(dialogRoot, TRAILER_ID_PREFIX);

      log('FINAL checks:', {
        isDoubleDeck,
        trailerId: vdCheck.id,
        trailerPrefixOk: vdCheck.result,
        restrictedBay: restricted
      });

      if (isDoubleDeck && vdCheck.result && restricted) {
        block(saveButton);
      } else {
        restore(saveButton);
      }
    };

    destinationSelect.addEventListener('change', applyRules);
    applyRules();
  }

  /* =========================
     WATCHER (SHORT-LIVED)
  ========================= */
  function watchForDialogOnce() {
    log('Starting dialog watcher');

    let stopped = false;
    let scheduled = false;

    const observer = new MutationObserver(() => {
      if (stopped || scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const dialog = findMovementDialogRoot();
        if (dialog) {
          bindRestrictions(dialog);
          observer.disconnect();
          stopped = true;
          log('Dialog watcher stopped');
        }
      }, 50);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // immediate check
    const dialog = findMovementDialogRoot();
    if (dialog) {
      bindRestrictions(dialog);
      observer.disconnect();
      log('Dialog watcher stopped (immediate)');
    }

    setTimeout(() => {
      if (!stopped) {
        observer.disconnect();
        log('Dialog watcher timeout stop');
      }
    }, 8000);
  }

  /* =========================
     CLICK HANDLER
  ========================= */
  document.body.addEventListener('click', (event) => {
    if (!isOnYardPage()) return;
    const btn = event.target.closest?.('.request-movement.highlight');
    if (btn) {
      log('Request movement clicked');
      watchForDialogOnce();
    }
  });

  /* =========================
     INIT
  ========================= */
  injectStyleOnce();
  log('DEBUG script loaded');

})();
