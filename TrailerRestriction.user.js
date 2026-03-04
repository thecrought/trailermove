// ==UserScript==
// @name         Trailer move restriction - Block SD + Low-height confirm + VS exemptions
// @namespace    http://tampermonkey.net/
// @version      2.6.0
// @description  Blocks VD* Double Deck moves to low-height SD bays; requires confirmation for other trailers into low-height bays; exempts VS40/VS42/VS43/VS44/VS48 from any restrictions.
// @author       Valdemar Iliev (valdemai)
// @match        https://trans-logistics-eu.amazon.com/*
// @grant        none
// @run-at       document-idle
//
// @downloadURL  https://raw.githubusercontent.com/thecrought/trailermove/main/TrailerRestriction.user.js
// @updateURL    https://raw.githubusercontent.com/thecrought/trailermove/main/TrailerRestriction.user.js
// @homepageURL  https://github.com/thecrought/trailermove
// ==/UserScript==

(function () {
  'use strict';

  /* =========================
     CONFIG
  ========================= */
  const YARD_HASH = '#/yard';

  const TRAILER_TYPE_MARKERS = [
    'Double Deck Trailer',
    'Double Deck',
    'DoubleDeck',
    'Double Decker Trailer'
  ];

  // Low height bays (< 4.3m)
  const LOW_HEIGHT_BAYS = ['DD14SD', 'DD19SD', 'DD20SD', 'DD21SD', 'DD22SD'];

  // Block rule: only for VD* double decks
  const TRAILER_ID_PREFIX = 'VD';

  // Exempt trailers: no restrictions/warnings apply (proceed as normal)
  const EXEMPT_TRAILER_PREFIXES = ['VS40', 'VS42', 'VS43', 'VS44', 'VS48'];

  // Visual classes
  const BLOCKED_CLASS = 'tm-dd-blocked-save'; // red
  const WARN_CLASS = 'tm-move-warn-save';     // amber

  const BLOCKED_LABEL = 'DO NOT MOVE';
  const WARN_LABEL = 'CONFIRM MOVE';

  // Styled confirm settings
  const HEIGHT_LIMIT_TEXT = '4.3 m';
  const HEIGHT_LIMIT_FT_TEXT = '14.1 ft'; // 4.3m ≈ 14.1ft

  // AAP guidance
  const AAP_URL = 'https://aap-eu.corp.amazon.com/';
  const AMAZON_CARRIER_FOR_AAP = 'ATSUK'; // only show AAP instruction for this carrier

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
    style.textContent = `
      .${BLOCKED_CLASS}{
        background:#d40000!important;
        color:#fff!important;
        border-color:#a30000!important;
      }
      .${BLOCKED_CLASS}:hover{ filter:brightness(0.97); }

      .${WARN_CLASS}{
        background:#ffbf00!important;
        color:#111!important;
        border-color:#c69200!important;
      }
      .${WARN_CLASS}:hover{ filter:brightness(0.97); }

      /* ===== Styled modal ===== */
      .tm-modal-backdrop{
        position:fixed; inset:0;
        background:rgba(0,0,0,.55);
        display:flex; align-items:center; justify-content:center;
        z-index:999999;
        padding:16px;
      }
      .tm-modal{
        width:min(600px, 96vw);
        background:#fff;
        border-radius:18px;
        box-shadow:0 24px 70px rgba(0,0,0,.38);
        overflow:visible;
        font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }

      /* Centered header text */
      .tm-modal-header{
        padding:20px 20px 8px;
        display:flex;
        flex-direction:column;
        align-items:center;
        text-align:center;
        gap:8px;
      }
      .tm-modal-icon{
        width:40px;
        height:40px;
        border-radius:12px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:rgba(255, 191, 0, .25);
        font-size:18px;
      }
      .tm-modal-headtext{
        display:flex;
        flex-direction:column;
        align-items:center;
        text-align:center;
        gap:6px;
      }
      .tm-modal-title{
        margin:0;
        font-size:16px;
        font-weight:700;
        color:#111;
      }
      .tm-modal-sub{
        margin:0;
        font-size:13px;
        color:rgba(0,0,0,.75);
        line-height:1.4;
      }
      .tm-red{
        color:#d40000;
        font-weight:700;
      }

      /* Badge: red, NO shadow */
      .tm-badge-wrap{
        display:flex;
        justify-content:center;
        padding:2px 20px 12px;
      }
      .tm-badge{
        display:inline-flex;
        align-items:center;
        gap:10px;
        padding:9px 14px;
        border-radius:999px;
        background:#d40000;
        color:#fff;
        font-weight:800;
        letter-spacing:.2px;
        width:fit-content;
        box-shadow:none;
      }
      .tm-badge .tm-badge-big{
        font-size:18px;
        letter-spacing:.3px;
        font-weight:800;
      }
      .tm-badge .tm-badge-small{
        font-size:12px;
        opacity:.95;
        font-weight:700;
      }

      .tm-modal-body{
        padding:0 20px 16px;
      }
      .tm-info{
        background:rgba(0,0,0,.03);
        border:1px solid rgba(0,0,0,.08);
        border-radius:14px;
        padding:14px 14px;
        font-size:13px;
        color:#111;
      }
      .tm-info strong{ font-weight:700; }
      .tm-info-row{
        display:flex;
        justify-content:space-between;
        gap:12px;
        margin-top:10px;
        font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size:12.5px;
        color:rgba(0,0,0,.78);
      }
      .tm-info-row span:last-child{
        font-weight:700;
        color:#111;
      }

      /* Guidance box */
      .tm-guidance{
        margin-top:12px;
        background:#fff;
        border:1px solid rgba(0,0,0,.10);
        border-radius:14px;
        padding:12px 12px;
        font-size:13px;
        color:#111;
      }
      .tm-guidance-title{
        font-weight:700;
        margin:0 0 8px 0;
        color:#111;
      }
      .tm-guidance ul{
        margin:0;
        padding-left:18px;
        color:rgba(0,0,0,.80);
        line-height:1.35;
      }
      .tm-guidance a{
        color:#1673d6;
        text-decoration:underline;
        font-weight:600;
      }

      /* Footer and buttons */
      .tm-modal-footer{
        padding:14px 20px 22px;
        display:flex;
        justify-content:center;
        gap:14px;
        border-top:1px solid rgba(0,0,0,.08);
        background:rgba(0,0,0,.02);
        overflow:visible;
      }

      .tm-btn{
        height:32px;
        padding:0 16px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius:6px;
        font-size:13px;
        font-weight:500;
        line-height:1;
        cursor:pointer;
        min-width:92px;
        box-sizing:border-box;
        background-clip:padding-box;
        transition:box-shadow .12s ease, outline-color .12s ease, background .12s ease, border-color .12s ease;
      }

      .tm-btn-cancel{
        background:#fff;
        color:#1673d6;
        border:1px solid #1673d6;
      }
      .tm-btn-cancel:hover{
        outline:2px solid rgba(22,115,214,.20);
        outline-offset:2px;
        box-shadow:0 2px 6px rgba(0,0,0,.08);
      }

      .tm-btn-proceed{
        background:#1673d6;
        color:#fff;
        border:1px solid #1673d6;
      }
      .tm-btn-proceed:hover{
        background:#1467bf;
        border-color:#1467bf;
        box-shadow:0 2px 6px rgba(0,0,0,.10);
      }
    `;
    document.head.appendChild(style);
  }

  /* =========================
     HELPERS
  ========================= */
  function normalize(str) {
    return String(str || '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/-/g, '');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function extractBayNumber(bay) {
    const m = String(bay || '').match(/\bDD(\d+)\s*SD\b/i);
    return m?.[1] || '';
  }

  function isExemptTrailer(trailerId) {
    const id = String(trailerId || '').toUpperCase();
    return EXEMPT_TRAILER_PREFIXES.some(p => id.startsWith(p));
  }

  function isAtsukCarrier(carrier) {
    return String(carrier || '').trim().toUpperCase() === AMAZON_CARRIER_FOR_AAP;
  }

  /* =========================
     CUSTOM CONFIRM MODAL
  ========================= */
  let tmModalOpen = false;

  function showHeightConfirmModal({ trailer, bay, carrier }) {
    return new Promise((resolve) => {
      if (tmModalOpen) return resolve(false);
      tmModalOpen = true;

      const bayNum = extractBayNumber(bay);
      const trailerSafe = trailer || '(unknown)';
      const baySafe = bay || '(none)';
      const carrierSafe = carrier || '(unknown)';

      const aapLine = isAtsukCarrier(carrierSafe)
        ? `<li><b>ATSUK trailer:</b> confirm height using <a href="${AAP_URL}" target="_blank" rel="noopener noreferrer">AAP Tool</a>.</li>`
        : '';

      const thirdPartyLine = !isAtsukCarrier(carrierSafe)
        ? `<li><b>3rd party / non-ATSUK:</b> confirm trailer height with the <b>YM</b> or <b>Shunter</b>.</li>`
        : `<li>If AAP data is unavailable, confirm height with the <b>YM</b> or <b>Shunter</b>.</li>`;

      const backdrop = document.createElement('div');
      backdrop.className = 'tm-modal-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'tm-modal';

      modal.innerHTML = `
        <div class="tm-modal-header">
          <div class="tm-modal-icon">⚠️</div>
          <div class="tm-modal-headtext">
            <h3 class="tm-modal-title">Low-height bay confirmation</h3>
            <p class="tm-modal-sub">
              You selected a <span class="tm-red">low-height bay</span>.<br/>
              Verify trailer height before proceeding.
            </p>
          </div>
        </div>

        <div class="tm-badge-wrap">
          <div class="tm-badge">
            <span class="tm-badge-small">MAX HEIGHT</span>
            <span class="tm-badge-big">${HEIGHT_LIMIT_TEXT}</span>
            <span class="tm-badge-small">(${HEIGHT_LIMIT_FT_TEXT})</span>
            ${bayNum ? `<span class="tm-badge-small">• Bay ${escapeHtml(bayNum)}</span>` : ''}
          </div>
        </div>

        <div class="tm-modal-body">
          <div class="tm-info">
            <div>
              <strong>Before you proceed:</strong>
              confirm the trailer you are moving is <strong>lower than ${HEIGHT_LIMIT_TEXT}</strong>.
            </div>

            <div class="tm-info-row"><span>Trailer</span><span>${escapeHtml(trailerSafe)}</span></div>
            <div class="tm-info-row"><span>Carrier</span><span>${escapeHtml(carrierSafe)}</span></div>
            <div class="tm-info-row"><span>Destination</span><span>${escapeHtml(baySafe)}</span></div>
          </div>

          <div class="tm-guidance">
            <p class="tm-guidance-title">How to confirm trailer height</p>
            <ul>
              ${aapLine}
              ${thirdPartyLine}
            </ul>
          </div>
        </div>

        <div class="tm-modal-footer">
          <button class="tm-btn tm-btn-cancel" id="tm-cancel">Cancel</button>
          <button class="tm-btn tm-btn-proceed" id="tm-proceed">Proceed</button>
        </div>
      `;

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      const btnCancel = modal.querySelector('#tm-cancel');
      const btnProceed = modal.querySelector('#tm-proceed');

      const cleanup = (result) => {
        tmModalOpen = false;
        backdrop.remove();
        resolve(result);
      };

      btnCancel?.addEventListener('click', () => cleanup(false));
      btnProceed?.addEventListener('click', () => cleanup(true));

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) cleanup(false);
      });

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onKeyDown, true);
          cleanup(false);
        }
      };
      document.addEventListener('keydown', onKeyDown, true);

      setTimeout(() => btnProceed?.focus(), 0);
    });
  }

  /* =========================
     BAY PARSING
  ========================= */
  function getSelectedBay(selectEl) {
    const opt = selectEl?.options?.[selectEl.selectedIndex];
    const rawText = (opt?.textContent || '').trim();
    const rawValue = (opt?.value || '').trim();

    if (/select destination/i.test(rawText)) return '';

    const mText = rawText.match(/\bDD(?:14|19|20|21|22)SD\b/i);
    const mValue = rawValue.match(/\bDD(?:14|19|20|21|22)SD\b/i);

    const picked = (mText?.[0] || mValue?.[0] || rawText || rawValue || '');
    return normalize(picked);
  }

  function isLowHeightBay(bay) {
    return LOW_HEIGHT_BAYS.includes(bay);
  }

  /* =========================
     DIALOG + BUTTON
  ========================= */
  function findMovementDialogRoot() {
    const dialogs = document.querySelectorAll(
      '[role="dialog"], .modal, .modal-dialog, .modal-content, .dialog, .popup'
    );
    for (const d of dialogs) {
      if (d.querySelector('select[ng-model="destination"]')) return d;
    }
    return null;
  }

  function getSaveButton(dialogRoot) {
    const buttons = Array.from(dialogRoot.querySelectorAll('button'));
    return buttons.find(b => (b.textContent || '').trim().toLowerCase().includes('save')) || null;
  }

  /* =========================
     VISUAL MODES (NO DISABLED TOGGLING)
  ========================= */
  function storeOriginalMarkup(btn) {
    if (!btn || btn.dataset.tmStored === '1') return;
    btn.dataset.tmStored = '1';
    btn.dataset.tmOrigHtml = btn.innerHTML;
  }

  function restoreOriginal(btn) {
    if (!btn) return;
    if (btn.dataset.tmOrigHtml) btn.innerHTML = btn.dataset.tmOrigHtml;
    btn.classList.remove(BLOCKED_CLASS);
    btn.classList.remove(WARN_CLASS);
    btn.removeAttribute('title');
    btn.dataset.tmMode = 'none';
  }

  function applyMode(btn, mode) {
    if (!btn) return;
    storeOriginalMarkup(btn);
    restoreOriginal(btn);

    if (mode === 'block') {
      try {
        const origHtml = btn.dataset.tmOrigHtml || btn.innerHTML || '';
        const replaced = origHtml.replace(/\bSave\b/gi, BLOCKED_LABEL);
        btn.innerHTML = replaced === origHtml ? origHtml : replaced;
      } catch {
        btn.textContent = BLOCKED_LABEL;
      }
      btn.classList.add(BLOCKED_CLASS);
      btn.setAttribute('title', 'Restricted: VD Double Deck cannot be moved to low-height SD bays.');
      btn.dataset.tmMode = 'block';
      return;
    }

    if (mode === 'warn') {
      try {
        const origHtml = btn.dataset.tmOrigHtml || btn.innerHTML || '';
        const replaced = origHtml.replace(/\bSave\b/gi, WARN_LABEL);
        btn.innerHTML = replaced === origHtml ? origHtml : replaced;
      } catch {
        btn.textContent = WARN_LABEL;
      }
      btn.classList.add(WARN_CLASS);
      btn.setAttribute('title', `Confirm: verify trailer height is lower than ${HEIGHT_LIMIT_TEXT} before moving into SD bay.`);
      btn.dataset.tmMode = 'warn';
    }
  }

  /* =========================
     TRAILER TYPE DETECTION
  ========================= */
  function detectDoubleDeck(dialogRoot) {
    const dialogText = dialogRoot.innerText || '';
    let found = TRAILER_TYPE_MARKERS.some(m => dialogText.includes(m));
    if (!found) {
      const pageText = document.body.innerText || '';
      found = TRAILER_TYPE_MARKERS.some(m => pageText.includes(m));
    }
    return found;
  }

  /* =========================
     TRAILER + CARRIER DETECTION (ROBUST VIA COLUMN HEADERS)
  ========================= */
  function extractTrailerInfo(dialogRoot) {
    const tables = Array.from(dialogRoot.querySelectorAll('table'));
    const table = tables.find(t => {
      const txt = (t.innerText || '').toLowerCase();
      return txt.includes('vehicle') && txt.includes('carrier') && txt.includes('id');
    }) || tables.find(t => {
      const txt = (t.innerText || '').toLowerCase();
      return txt.includes('vehicle') && txt.includes('id');
    });

    if (!table) return { id: '', carrier: '' };

    const headerRow = table.querySelector('tr');
    const headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th, td')) : [];
    const norm = (x) => (x || '').trim().toLowerCase();

    let idIdx = headerCells.findIndex(c => norm(c.textContent) === 'id');
    if (idIdx < 0) idIdx = headerCells.findIndex(c => norm(c.textContent).includes('id'));

    let carrierIdx = headerCells.findIndex(c => norm(c.textContent) === 'carrier');
    if (carrierIdx < 0) carrierIdx = headerCells.findIndex(c => norm(c.textContent).includes('carrier'));

    // Prefer checked row
    let row = null;
    const checked = table.querySelector('input[type="checkbox"]:checked');
    if (checked) row = checked.closest('tr');

    // Fallback: first data row that looks like a trailer row
    if (!row) {
      const rows = Array.from(table.querySelectorAll('tr')).slice(1);
      row = rows.find(r => (r.innerText || '').toLowerCase().includes('trailer')) || null;
    }
    if (!row) return { id: '', carrier: '' };

    const cells = Array.from(row.querySelectorAll('td, th'));
    const rawId = idIdx >= 0 ? (cells[idIdx]?.textContent || '').trim() : '';
    const rawCarrier = carrierIdx >= 0 ? (cells[carrierIdx]?.textContent || '').trim() : '';

    return {
      id: rawId ? rawId.toUpperCase() : '',
      carrier: rawCarrier ? rawCarrier.toUpperCase() : ''
    };
  }

  function detectTrailerStartsWithPrefix(dialogRoot, prefix) {
    const info = extractTrailerInfo(dialogRoot);
    const id = info.id || '';
    return { result: id.startsWith(prefix.toUpperCase()), id, carrier: info.carrier || '' };
  }

  /* =========================
     CORE BINDING
  ========================= */
  function bindRestrictions(dialogRoot) {
    if (dialogRoot.dataset.tmBound === '1') return;
    dialogRoot.dataset.tmBound = '1';

    const destinationSelect = dialogRoot.querySelector('select[ng-model="destination"]');
    const saveButton = getSaveButton(dialogRoot);

    if (!destinationSelect || !saveButton) return;

    storeOriginalMarkup(saveButton);
    let lastMode = null;

    const compute = () => {
      const bay = getSelectedBay(destinationSelect);
      const isLow = isLowHeightBay(bay);

      const isDoubleDeck = detectDoubleDeck(dialogRoot);
      const idCheck = detectTrailerStartsWithPrefix(dialogRoot, TRAILER_ID_PREFIX);

      const trailerId = (idCheck.id || '').toUpperCase();
      const carrier = (idCheck.carrier || '').toUpperCase();
      const exempt = isExemptTrailer(trailerId);

      const shouldBlock = exempt ? false : Boolean(isLow && isDoubleDeck && idCheck.result);
      const shouldWarn = exempt ? false : Boolean(isLow && !shouldBlock);

      saveButton.dataset.tmExempt = exempt ? '1' : '0';
      saveButton.dataset.tmShouldBlock = shouldBlock ? '1' : '0';
      saveButton.dataset.tmShouldWarn = shouldWarn ? '1' : '0';
      saveButton.dataset.tmTrailer = trailerId;
      saveButton.dataset.tmCarrier = carrier;
      saveButton.dataset.tmBay = bay || '';
      saveButton.dataset.tmIsDoubleDeck = isDoubleDeck ? '1' : '0';

      return { exempt, shouldBlock, shouldWarn };
    };

    const applyRules = () => {
      const { exempt, shouldBlock, shouldWarn } = compute();

      let mode = 'none';
      if (!exempt) {
        if (shouldBlock) mode = 'block';
        else if (shouldWarn) mode = 'warn';
      }

      if (mode !== lastMode) {
        lastMode = mode;
        applyMode(saveButton, mode);
      } else if (mode === 'none') {
        restoreOriginal(saveButton);
      }
    };

    destinationSelect.addEventListener('change', applyRules);
    destinationSelect.addEventListener('input', applyRules);
    destinationSelect.addEventListener('click', applyRules);

    saveButton.addEventListener('click', async (e) => {
      const exempt = saveButton.dataset.tmExempt === '1';
      const shouldBlock = saveButton.dataset.tmShouldBlock === '1';
      const shouldWarn = saveButton.dataset.tmShouldWarn === '1';
      const trailer = saveButton.dataset.tmTrailer || '(unknown)';
      const carrier = saveButton.dataset.tmCarrier || '';
      const bay = saveButton.dataset.tmBay || '(none)';

      if (exempt) return;

      if (shouldBlock) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return;
      }

      if (shouldWarn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        const ok = await showHeightConfirmModal({ trailer, bay, carrier });
        if (ok) {
          saveButton.dataset.tmShouldWarn = '0';
          setTimeout(() => saveButton.click(), 0);
        }
      }
    }, true);

    applyRules();
  }

  /* =========================
     WATCHER (SHORT-LIVED)
  ========================= */
  function watchForDialogOnce() {
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
        }
      }, 50);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const dialog = findMovementDialogRoot();
    if (dialog) {
      bindRestrictions(dialog);
      observer.disconnect();
      stopped = true;
    }

    setTimeout(() => {
      if (!stopped) observer.disconnect();
    }, 8000);
  }

  /* =========================
     CLICK HANDLER
  ========================= */
  document.body.addEventListener('click', (event) => {
    if (!isOnYardPage()) return;
    const btn = event.target.closest?.('.request-movement.highlight');
    if (btn) watchForDialogOnce();
  });

  /* =========================
     INIT
  ========================= */
  injectStyleOnce();
})();