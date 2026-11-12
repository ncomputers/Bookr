import {formatRupees, parseRupees} from './entry-values.js';

export function createInventoryMasters({
  main,
  hint,
  setScreen,
  getView,
  getBook,
  refreshBook,
  api,
  escapeHtml,
  askDialog,
  openMastersMenu
}) {
  let busy = false;
  let activeMaster = null; // {type: 'unit'|'godown'|'stock-group'|'stock-item', mode: 'create'|'alter', item: object|null, initial: string}

  function markScreen(title, viewName, hintText) {
    setScreen(title, viewName, hintText);
  }

  function isFormDirty() {
    if (!activeMaster) return false;
    const current = currentSnapshot();
    return current !== activeMaster.initial;
  }

  function currentSnapshot() {
    if (!activeMaster) return '';
    const form = main.querySelector('form');
    if (!form) return '';
    const data = {};
    for (const el of form.elements) {
      if (el.name && !el.disabled) data[el.name] = el.value;
    }
    return JSON.stringify(data);
  }

  // ==========================================
  // 1. UNITS MASTER
  // ==========================================

  async function openUnitSelector() {
    if (busy) return;
    busy = true;
    try {
      const units = await api('/api/inventory/units');
      markScreen('Select Unit', 'unit-selector', 'Select unit to alter · ↑ ↓ Enter · Esc: back');
      main.innerHTML = `<section class="ledger-selector" aria-label="Select unit">
        <label for="unit-search">Symbol of Unit</label>
        <input id="unit-search" type="text" autocomplete="off" aria-controls="unit-options">
        <div class="selection-heading">List of Units</div>
        <div id="unit-options" role="listbox" aria-label="Units"></div>
        <p class="selection-note">Units of measure · ${units.length} units</p>
      </section>`;

      let candidates = [...units];
      let selectedIdx = 0;
      const search = main.querySelector('#unit-search');
      const options = main.querySelector('#unit-options');

      function renderOptions() {
        const query = search.value.trim().toLowerCase();
        candidates = units.filter(u => `${u.symbol} ${u.formal_name || ''} ${u.uqc || ''}`.toLowerCase().includes(query));
        selectedIdx = Math.max(0, Math.min(selectedIdx, candidates.length - 1));
        options.innerHTML = candidates.length
          ? candidates.map((u, i) => `
            <button type="button" role="option" class="${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
              ${escapeHtml(u.symbol)}${u.formal_name ? ` <small>(${escapeHtml(u.formal_name)})</small>` : ''}
              ${u.uqc ? `<small>[${escapeHtml(u.uqc)}]</small>` : ''}
            </button>
          `).join('')
          : '<p class="no-ledgers">No matching units found.</p>';

        options.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            selectedIdx = Number(btn.dataset.idx);
            openUnitForm(candidates[selectedIdx]);
          };
        });
      }

      search.oninput = () => {
        selectedIdx = 0;
        renderOptions();
      };

      search.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIdx = (selectedIdx + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
          renderOptions();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (candidates[selectedIdx]) openUnitForm(candidates[selectedIdx]);
        }
      };

      renderOptions();
      search.focus();
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function openUnitForm(unit = null) {
    if (busy) return;
    busy = true;
    try {
      const isAlter = Boolean(unit);
      markScreen(
        isAlter ? 'Unit Alteration' : 'Unit Creation',
        'unit-form',
        'Enter: next · Shift+Tab: back · Ctrl+A: save · Esc: back'
      );

      main.innerHTML = `<form id="unit-master-form" novalidate autocomplete="off">
        <div class="ledger-identity">
          <div class="identity-fields">
            <div class="identity-row">
              <label for="unit-symbol">Symbol</label><span>:</span>
              <input id="unit-symbol" name="symbol" maxlength="20" required value="${escapeHtml(unit?.symbol ?? '')}" spellcheck="false">
            </div>
            <div class="identity-row">
              <label for="unit-formal-name">Formal name</label><span>:</span>
              <input id="unit-formal-name" name="formal_name" maxlength="120" value="${escapeHtml(unit?.formal_name ?? '')}" spellcheck="false">
            </div>
          </div>
        </div>
        <div class="ledger-detail-columns">
          <section class="ledger-accounting" aria-label="Unit details">
            <div class="accounting-row">
              <label for="unit-uqc">Unit Quantity Code (UQC)</label><span>:</span>
              <div>
                <select id="unit-uqc" name="uqc">
                  <option value="">Not Applicable</option>
                  <option value="BAG-BAGS" ${(unit?.uqc ?? '') === 'BAG-BAGS' ? 'selected' : ''}>BAG - BAGS</option>
                  <option value="BDL-BUNDLES" ${(unit?.uqc ?? '') === 'BDL-BUNDLES' ? 'selected' : ''}>BDL - BUNDLES</option>
                  <option value="BOX-BOX" ${(unit?.uqc ?? '') === 'BOX-BOX' ? 'selected' : ''}>BOX - BOX</option>
                  <option value="BTL-BOTTLES" ${(unit?.uqc ?? '') === 'BTL-BOTTLES' ? 'selected' : ''}>BTL - BOTTLES</option>
                  <option value="CAN-CANS" ${(unit?.uqc ?? '') === 'CAN-CANS' ? 'selected' : ''}>CAN - CANS</option>
                  <option value="CTN-CARTONS" ${(unit?.uqc ?? '') === 'CTN-CARTONS' ? 'selected' : ''}>CTN - CARTONS</option>
                  <option value="DOZ-DOZENS" ${(unit?.uqc ?? '') === 'DOZ-DOZENS' ? 'selected' : ''}>DOZ - DOZENS</option>
                  <option value="DRM-DRUMS" ${(unit?.uqc ?? '') === 'DRM-DRUMS' ? 'selected' : ''}>DRM - DRUMS</option>
                  <option value="KGS-KILOGRAMS" ${(unit?.uqc ?? '') === 'KGS-KILOGRAMS' ? 'selected' : ''}>KGS - KILOGRAMS</option>
                  <option value="KLR-KILOLITRE" ${(unit?.uqc ?? '') === 'KLR-KILOLITRE' ? 'selected' : ''}>KLR - KILOLITRE</option>
                  <option value="LTR-LITRES" ${(unit?.uqc ?? '') === 'LTR-LITRES' ? 'selected' : ''}>LTR - LITRES</option>
                  <option value="MTR-METRES" ${(unit?.uqc ?? '') === 'MTR-METRES' ? 'selected' : ''}>MTR - METRES</option>
                  <option value="NOS-NUMBERS" ${(unit?.uqc ?? 'NOS-NUMBERS') === 'NOS-NUMBERS' ? 'selected' : ''}>NOS - NUMBERS</option>
                  <option value="PAC-PACKETS" ${(unit?.uqc ?? '') === 'PAC-PACKETS' ? 'selected' : ''}>PAC - PACKETS</option>
                  <option value="PCS-PIECES" ${(unit?.uqc ?? '') === 'PCS-PIECES' ? 'selected' : ''}>PCS - PIECES</option>
                  <option value="PRS-PAIRS" ${(unit?.uqc ?? '') === 'PRS-PAIRS' ? 'selected' : ''}>PRS - PAIRS</option>
                  <option value="QTL-QUINTAL" ${(unit?.uqc ?? '') === 'QTL-QUINTAL' ? 'selected' : ''}>QTL - QUINTAL</option>
                  <option value="ROL-ROLLS" ${(unit?.uqc ?? '') === 'ROL-ROLLS' ? 'selected' : ''}>ROL - ROLLS</option>
                  <option value="SET-SETS" ${(unit?.uqc ?? '') === 'SET-SETS' ? 'selected' : ''}>SET - SETS</option>
                  <option value="SQF-SQUARE FEET" ${(unit?.uqc ?? '') === 'SQF-SQUARE FEET' ? 'selected' : ''}>SQF - SQUARE FEET</option>
                  <option value="SQM-SQUARE METRES" ${(unit?.uqc ?? '') === 'SQM-SQUARE METRES' ? 'selected' : ''}>SQM - SQUARE METRES</option>
                  <option value="TBS-TABLETS" ${(unit?.uqc ?? '') === 'TBS-TABLETS' ? 'selected' : ''}>TBS - TABLETS</option>
                  <option value="TUB-TUBES" ${(unit?.uqc ?? '') === 'TUB-TUBES' ? 'selected' : ''}>TUB - TUBES</option>
                  <option value="UNT-UNITS" ${(unit?.uqc ?? '') === 'UNT-UNITS' ? 'selected' : ''}>UNT - UNITS</option>
                  <option value="OTH-OTHERS" ${(unit?.uqc ?? '') === 'OTH-OTHERS' ? 'selected' : ''}>OTH - OTHERS</option>
                </select>
              </div>
            </div>
            <div class="accounting-row">
              <label for="unit-decimal-places">Number of decimal places</label><span>:</span>
              <div>
                <select id="unit-decimal-places" name="decimal_places">
                  <option value="0" ${(unit?.decimal_places ?? 0) === 0 ? 'selected' : ''}>0</option>
                  <option value="1" ${(unit?.decimal_places ?? 0) === 1 ? 'selected' : ''}>1</option>
                  <option value="2" ${(unit?.decimal_places ?? 0) === 2 ? 'selected' : ''}>2</option>
                  <option value="3" ${(unit?.decimal_places ?? 0) === 3 ? 'selected' : ''}>3</option>
                  <option value="4" ${(unit?.decimal_places ?? 0) === 4 ? 'selected' : ''}>4</option>
                </select>
              </div>
            </div>
          </section>
        </div>
        <div id="unit-error" class="ledger-error" role="alert"></div>
        ${isAlter ? '<div class="details-commands master-delete-container"><button type="button" id="delete-unit" class="master-delete-btn">Delete Unit (Alt+D)</button></div>' : ''}
      </form>`;

      activeMaster = {
        type: 'unit',
        mode: isAlter ? 'alter' : 'create',
        item: unit,
        initial: ''
      };
      activeMaster.initial = currentSnapshot();

      const symbolInput = main.querySelector('#unit-symbol');
      symbolInput.focus();

      if (isAlter) {
        main.querySelector('#delete-unit')?.addEventListener('click', () => {
          askDialog(`Delete unit ${unit.symbol}?`, async () => {
            try {
              await api('/api/inventory/units/' + unit.id, {method: 'DELETE'});
              hint.textContent = `Deleted ${unit.symbol}`;
              activeMaster = null;
              openUnitSelector();
            } catch (e) {
              main.querySelector('#unit-error').textContent = e.message;
            }
          }, 'Delete');
        });
      }
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function saveUnit() {
    if (busy || !activeMaster || activeMaster.type !== 'unit') return;
    const form = main.querySelector('#unit-master-form');
    if (!form) return;
    const symbol = form.symbol.value.trim();
    const formal_name = form.formal_name.value.trim();
    const decimal_places = Number(form.decimal_places.value) || 0;
    const uqc = form.uqc.value.trim();
    const errorBox = main.querySelector('#unit-error');
    errorBox.textContent = '';

    if (!symbol) {
      errorBox.textContent = 'Enter a unit symbol.';
      form.symbol.focus();
      return;
    }

    busy = true;
    try {
      if (activeMaster.mode === 'create') {
        const payload = {symbol, formal_name, decimal_places, uqc};
        await api('/api/inventory/units', {method: 'POST', body: JSON.stringify(payload)});
        hint.textContent = `Saved Unit ${symbol}`;
        activeMaster = null;
        openUnitForm();
      } else {
        const payload = {symbol, formal_name, decimal_places, uqc};
        await api('/api/inventory/units/' + activeMaster.item.id, {method: 'PUT', body: JSON.stringify(payload)});
        hint.textContent = `Updated Unit ${symbol}`;
        activeMaster = null;
        openUnitSelector();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    } finally {
      busy = false;
    }
  }

  // ==========================================
  // 2. GODOWNS MASTER
  // ==========================================

  async function openGodownSelector() {
    if (busy) return;
    busy = true;
    try {
      const godowns = await api('/api/inventory/godowns');
      markScreen('Select Godown', 'godown-selector', 'Select godown to alter · ↑ ↓ Enter · Esc: back');
      main.innerHTML = `<section class="ledger-selector" aria-label="Select godown">
        <label for="godown-search">Name of Godown</label>
        <input id="godown-search" type="text" autocomplete="off" aria-controls="godown-options">
        <div class="selection-heading">List of Godowns</div>
        <div id="godown-options" role="listbox" aria-label="Godowns"></div>
        <p class="selection-note">Storage locations · ${godowns.length} godowns</p>
      </section>`;

      let candidates = [...godowns];
      let selectedIdx = 0;
      const search = main.querySelector('#godown-search');
      const options = main.querySelector('#godown-options');

      function renderOptions() {
        const query = search.value.trim().toLowerCase();
        candidates = godowns.filter(g => `${g.name} ${g.address || ''} ${g.parent_name || ''}`.toLowerCase().includes(query));
        selectedIdx = Math.max(0, Math.min(selectedIdx, candidates.length - 1));
        options.innerHTML = candidates.length
          ? candidates.map((g, i) => `
            <button type="button" role="option" class="${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
              ${escapeHtml(g.name)}${g.parent_name ? ` <small>(Under: ${escapeHtml(g.parent_name)})</small>` : ''}
              ${g.is_default ? '<small>(Default)</small>' : ''}
            </button>
          `).join('')
          : '<p class="no-ledgers">No matching godowns found.</p>';

        options.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            selectedIdx = Number(btn.dataset.idx);
            openGodownForm(candidates[selectedIdx]);
          };
        });
      }

      search.oninput = () => {
        selectedIdx = 0;
        renderOptions();
      };

      search.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIdx = (selectedIdx + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
          renderOptions();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (candidates[selectedIdx]) openGodownForm(candidates[selectedIdx]);
        }
      };

      renderOptions();
      search.focus();
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function openGodownForm(godown = null) {
    if (busy) return;
    busy = true;
    try {
      const godowns = await api('/api/inventory/godowns');
      const isAlter = Boolean(godown);
      markScreen(
        isAlter ? 'Godown Alteration' : 'Godown Creation',
        'godown-form',
        'Enter: next · Shift+Tab: back · Ctrl+A: save · Esc: back'
      );

      main.innerHTML = `<form id="godown-master-form" novalidate autocomplete="off">
        <div class="ledger-identity">
          <div class="identity-fields">
            <div class="identity-row">
              <label for="godown-name">Name</label><span>:</span>
              <input id="godown-name" name="name" maxlength="120" required value="${escapeHtml(godown?.name ?? '')}" spellcheck="false">
            </div>
          </div>
        </div>
        <div class="ledger-detail-columns">
          <section class="ledger-accounting" aria-label="Godown details">
            <div class="accounting-row">
              <label for="godown-parent">Under</label><span>:</span>
              <div>
                <select id="godown-parent" name="parent_id">
                  <option value="">Primary</option>
                  ${godowns.filter(g => !godown || g.id !== godown.id).map(g => `
                    <option value="${g.id}" ${godown?.parent_id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="accounting-row">
              <label for="godown-address">Address</label><span>:</span>
              <div>
                <textarea id="godown-address" name="address" rows="3" maxlength="255">${escapeHtml(godown?.address ?? '')}</textarea>
              </div>
            </div>
            ${godown?.is_default ? '<p class="selection-note">Default godown (cannot be deleted).</p>' : ''}
          </section>
        </div>
        <div id="godown-error" class="ledger-error" role="alert"></div>
        ${isAlter && !godown.is_default ? '<div class="details-commands master-delete-container"><button type="button" id="delete-godown" class="master-delete-btn">Delete Godown (Alt+D)</button></div>' : ''}
      </form>`;

      activeMaster = {
        type: 'godown',
        mode: isAlter ? 'alter' : 'create',
        item: godown,
        initial: ''
      };
      activeMaster.initial = currentSnapshot();

      const nameInput = main.querySelector('#godown-name');
      nameInput.focus();

      if (isAlter && !godown.is_default) {
        main.querySelector('#delete-godown')?.addEventListener('click', () => {
          askDialog(`Delete godown ${godown.name}?`, async () => {
            try {
              await api('/api/inventory/godowns/' + godown.id, {method: 'DELETE'});
              hint.textContent = `Deleted ${godown.name}`;
              activeMaster = null;
              openGodownSelector();
            } catch (e) {
              main.querySelector('#godown-error').textContent = e.message;
            }
          }, 'Delete');
        });
      }
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function saveGodown() {
    if (busy || !activeMaster || activeMaster.type !== 'godown') return;
    const form = main.querySelector('#godown-master-form');
    if (!form) return;
    const name = form.name.value.trim();
    const parentVal = form.parent_id?.value;
    const parent_id = parentVal ? Number(parentVal) : null;
    const address = form.address.value.trim();
    const errorBox = main.querySelector('#godown-error');
    errorBox.textContent = '';

    if (!name) {
      errorBox.textContent = 'Enter a godown name.';
      form.name.focus();
      return;
    }

    busy = true;
    try {
      if (activeMaster.mode === 'create') {
        const payload = {name, parent_id, address};
        await api('/api/inventory/godowns', {method: 'POST', body: JSON.stringify(payload)});
        hint.textContent = `Saved Godown ${name}`;
        activeMaster = null;
        openGodownForm();
      } else {
        const payload = {name, parent_id, address};
        await api('/api/inventory/godowns/' + activeMaster.item.id, {method: 'PUT', body: JSON.stringify(payload)});
        hint.textContent = `Updated Godown ${name}`;
        activeMaster = null;
        openGodownSelector();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    } finally {
      busy = false;
    }
  }

  // ==========================================
  // 3. STOCK GROUPS MASTER
  // ==========================================

  async function openStockGroupSelector() {
    if (busy) return;
    busy = true;
    try {
      const groups = await api('/api/inventory/stock-groups');
      markScreen('Select Stock Group', 'stock-group-selector', 'Select stock group to alter · ↑ ↓ Enter · Esc: back');
      main.innerHTML = `<section class="ledger-selector" aria-label="Select stock group">
        <label for="stock-group-search">Name of Stock Group</label>
        <input id="stock-group-search" type="text" autocomplete="off" aria-controls="stock-group-options">
        <div class="selection-heading">List of Stock Groups</div>
        <div id="stock-group-options" role="listbox" aria-label="Stock groups"></div>
        <p class="selection-note">Item categories and groups · ${groups.length} groups</p>
      </section>`;

      let candidates = [...groups];
      let selectedIdx = 0;
      const search = main.querySelector('#stock-group-search');
      const options = main.querySelector('#stock-group-options');

      function renderOptions() {
        const query = search.value.trim().toLowerCase();
        candidates = groups.filter(g => `${g.name} ${g.parent_name || ''}`.toLowerCase().includes(query));
        selectedIdx = Math.max(0, Math.min(selectedIdx, candidates.length - 1));
        options.innerHTML = candidates.length
          ? candidates.map((g, i) => `
            <button type="button" role="option" class="${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
              ${escapeHtml(g.name)}${g.parent_name ? ` <small>(Under: ${escapeHtml(g.parent_name)})</small>` : ''}
              ${g.name.toLowerCase() === 'primary' ? '<small>(Primary)</small>' : ''}
            </button>
          `).join('')
          : '<p class="no-ledgers">No matching stock groups found.</p>';

        options.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            selectedIdx = Number(btn.dataset.idx);
            openStockGroupForm(candidates[selectedIdx]);
          };
        });
      }

      search.oninput = () => {
        selectedIdx = 0;
        renderOptions();
      };

      search.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIdx = (selectedIdx + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
          renderOptions();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (candidates[selectedIdx]) openStockGroupForm(candidates[selectedIdx]);
        }
      };

      renderOptions();
      search.focus();
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function openStockGroupForm(group = null) {
    if (busy) return;
    busy = true;
    try {
      const groups = await api('/api/inventory/stock-groups');
      const isAlter = Boolean(group);
      const isPrimary = group && group.name.toLowerCase() === 'primary';
      markScreen(
        isAlter ? 'Stock Group Alteration' : 'Stock Group Creation',
        'stock-group-form',
        'Enter: next · Shift+Tab: back · Ctrl+A: save · Esc: back'
      );

      main.innerHTML = `<form id="stock-group-master-form" novalidate autocomplete="off">
        <div class="ledger-identity">
          <div class="identity-fields">
            <div class="identity-row">
              <label for="stock-group-name">Name</label><span>:</span>
              <input id="stock-group-name" name="name" maxlength="120" required value="${escapeHtml(group?.name ?? '')}" ${isPrimary ? 'readonly' : ''} spellcheck="false">
            </div>
          </div>
        </div>
        <div class="ledger-detail-columns">
          <section class="ledger-accounting" aria-label="Stock group details">
            <div class="accounting-row">
              <label for="stock-group-parent">Under</label><span>:</span>
              <div>
                <select id="stock-group-parent" name="parent_id" ${isPrimary ? 'disabled' : ''}>
                  <option value="">Primary</option>
                  ${groups.filter(g => (!group || g.id !== group.id) && g.name.toLowerCase() !== 'primary').map(g => `
                    <option value="${g.id}" ${group?.parent_id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="accounting-row">
              <label for="stock-group-addable">Should quantities of items be added</label><span>:</span>
              <div>
                <select id="stock-group-addable" name="is_addable">
                  <option value="1" ${(group?.is_addable ?? 1) === 1 ? 'selected' : ''}>Yes</option>
                  <option value="0" ${(group?.is_addable ?? 1) === 0 ? 'selected' : ''}>No</option>
                </select>
              </div>
            </div>
            ${isPrimary ? '<p class="selection-note">Primary standard group cannot be modified or deleted.</p>' : ''}
          </section>
        </div>
        <div id="stock-group-error" class="ledger-error" role="alert"></div>
        ${isAlter && !isPrimary ? '<div class="details-commands master-delete-container"><button type="button" id="delete-stock-group" class="master-delete-btn">Delete Stock Group (Alt+D)</button></div>' : ''}
      </form>`;

      activeMaster = {
        type: 'stock-group',
        mode: isAlter ? 'alter' : 'create',
        item: group,
        initial: ''
      };
      activeMaster.initial = currentSnapshot();

      const nameInput = main.querySelector('#stock-group-name');
      nameInput.focus();

      if (isAlter && !isPrimary) {
        main.querySelector('#delete-stock-group')?.addEventListener('click', () => {
          askDialog(`Delete stock group ${group.name}?`, async () => {
            try {
              await api('/api/inventory/stock-groups/' + group.id, {method: 'DELETE'});
              hint.textContent = `Deleted ${group.name}`;
              activeMaster = null;
              openStockGroupSelector();
            } catch (e) {
              main.querySelector('#stock-group-error').textContent = e.message;
            }
          }, 'Delete');
        });
      }
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function saveStockGroup() {
    if (busy || !activeMaster || activeMaster.type !== 'stock-group') return;
    const form = main.querySelector('#stock-group-master-form');
    if (!form) return;
    const name = form.name.value.trim();
    const parentVal = form.parent_id?.value;
    const parent_id = parentVal ? Number(parentVal) : null;
    const is_addable = Number(form.is_addable.value) || 0;
    const errorBox = main.querySelector('#stock-group-error');
    errorBox.textContent = '';

    if (!name) {
      errorBox.textContent = 'Enter a stock group name.';
      form.name.focus();
      return;
    }

    busy = true;
    try {
      if (activeMaster.mode === 'create') {
        const payload = {name, parent_id, is_addable};
        await api('/api/inventory/stock-groups', {method: 'POST', body: JSON.stringify(payload)});
        hint.textContent = `Saved Stock Group ${name}`;
        activeMaster = null;
        openStockGroupForm();
      } else {
        if (activeMaster.item.name.toLowerCase() === 'primary') {
          activeMaster = null;
          openMastersMenu('alter');
          return;
        }
        const payload = {name, parent_id, is_addable};
        await api('/api/inventory/stock-groups/' + activeMaster.item.id, {method: 'PUT', body: JSON.stringify(payload)});
        hint.textContent = `Updated Stock Group ${name}`;
        activeMaster = null;
        openStockGroupSelector();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    } finally {
      busy = false;
    }
  }

  // ==========================================
  // 4. STOCK ITEMS MASTER
  // ==========================================

  async function openStockItemSelector() {
    if (busy) return;
    busy = true;
    try {
      const items = await api('/api/inventory/stock-items');
      markScreen('Select Stock Item', 'stock-item-selector', 'Select stock item to alter · ↑ ↓ Enter · Esc: back');
      main.innerHTML = `<section class="ledger-selector" aria-label="Select stock item">
        <label for="stock-item-search">Name of Item</label>
        <input id="stock-item-search" type="text" autocomplete="off" aria-controls="stock-item-options">
        <div class="selection-heading">List of Stock Items</div>
        <div id="stock-item-options" role="listbox" aria-label="Stock items"></div>
        <p class="selection-note">Inventory items · ${items.length} items</p>
      </section>`;

      let candidates = [...items];
      let selectedIdx = 0;
      const search = main.querySelector('#stock-item-search');
      const options = main.querySelector('#stock-item-options');

      function renderOptions() {
        const query = search.value.trim().toLowerCase();
        candidates = items.filter(si => `${si.name} ${si.part_number || ''} ${si.group_name || ''} ${si.hsn_sac || ''}`.toLowerCase().includes(query));
        selectedIdx = Math.max(0, Math.min(selectedIdx, candidates.length - 1));
        options.innerHTML = candidates.length
          ? candidates.map((si, i) => `
            <button type="button" role="option" class="${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
              ${escapeHtml(si.name)}${si.part_number ? ` <small>[${escapeHtml(si.part_number)}]</small>` : ''}
              <small>(${escapeHtml(si.unit_symbol || 'Nos')})</small>
              ${si.group_name ? `<small>Under: ${escapeHtml(si.group_name)}</small>` : ''}
            </button>
          `).join('')
          : '<p class="no-ledgers">No matching stock items found.</p>';

        options.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            selectedIdx = Number(btn.dataset.idx);
            openStockItemForm(candidates[selectedIdx]);
          };
        });
      }

      search.oninput = () => {
        selectedIdx = 0;
        renderOptions();
      };

      search.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIdx = (selectedIdx + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
          renderOptions();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (candidates[selectedIdx]) openStockItemForm(candidates[selectedIdx]);
        }
      };

      renderOptions();
      search.focus();
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function openStockItemForm(item = null) {
    if (busy) return;
    busy = true;
    try {
      const [units, groups, godowns] = await Promise.all([
        api('/api/inventory/units'),
        api('/api/inventory/stock-groups'),
        api('/api/inventory/godowns')
      ]);
      const isAlter = Boolean(item);
      markScreen(
        isAlter ? 'Stock Item Alteration' : 'Stock Item Creation',
        'stock-item-form',
        'Enter: next · Shift+Tab: back · Ctrl+A: save · Esc: back'
      );

      const defaultUnitId = units[0]?.id ?? '';
      const defaultGroupId = groups.find(g => g.name.toLowerCase() === 'primary')?.id ?? groups[0]?.id ?? '';
      const defaultGodownId = godowns.find(g => g.is_default)?.id ?? godowns[0]?.id ?? '';

      main.innerHTML = `<form id="stock-item-master-form" novalidate autocomplete="off">
        <div class="ledger-identity">
          <div class="identity-fields">
            <div class="identity-row">
              <label for="item-name">Name</label><span>:</span>
              <input id="item-name" name="name" maxlength="120" required value="${escapeHtml(item?.name ?? '')}" spellcheck="false">
            </div>
            <div class="identity-row">
              <label for="item-part-number"><i>(part no.)</i></label><span>:</span>
              <input id="item-part-number" name="part_number" maxlength="60" value="${escapeHtml(item?.part_number ?? '')}" spellcheck="false">
            </div>
          </div>
        </div>
        <div class="ledger-detail-columns">
          <section class="ledger-accounting" aria-label="Item details">
            <div class="accounting-row">
              <label for="item-group">Under</label><span>:</span>
              <div>
                <select id="item-group" name="stock_group_id">
                  ${groups.map(g => `
                    <option value="${g.id}" ${(item?.stock_group_id ?? defaultGroupId) === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="accounting-row">
              <label for="item-unit">Units</label><span>:</span>
              <div>
                <select id="item-unit" name="unit_id" required>
                  ${units.map(u => `
                    <option value="${u.id}" ${(item?.unit_id ?? defaultUnitId) === u.id ? 'selected' : ''}>${escapeHtml(u.symbol)}${u.formal_name ? ` (${escapeHtml(u.formal_name)})` : ''}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <h2 class="inventory-section-title">STATUTORY DETAILS</h2>
            <div class="accounting-row">
              <label for="item-hsn">HSN / SAC</label><span>:</span>
              <div>
                <input id="item-hsn" name="hsn_sac" maxlength="20" value="${escapeHtml(item?.hsn_sac ?? '')}">
              </div>
            </div>
            <div class="accounting-row">
              <label for="item-taxability">Taxability</label><span>:</span>
              <div>
                <select id="item-taxability" name="taxability">
                  <option value="Taxable" ${(item?.taxability ?? 'Taxable') === 'Taxable' ? 'selected' : ''}>Taxable</option>
                  <option value="Exempt" ${(item?.taxability ?? '') === 'Exempt' ? 'selected' : ''}>Exempt</option>
                  <option value="Nil Rated" ${(item?.taxability ?? '') === 'Nil Rated' ? 'selected' : ''}>Nil Rated</option>
                </select>
              </div>
            </div>
            <div class="accounting-row" id="item-rate-row">
              <label for="item-gst-rate">Integrated Tax (%)</label><span>:</span>
              <div>
                <input id="item-gst-rate" name="gst_rate" type="number" min="0" max="100" step="0.01" value="${item?.gst_rate ?? 0}">
              </div>
            </div>
          </section>
          <section class="ledger-mailing" aria-label="Opening Balance">
            <h2>Opening Balance</h2>
            <div class="mailing-row">
              <label for="item-opening-qty">Quantity</label><span>:</span>
              <input id="item-opening-qty" name="opening_qty" type="number" step="any" min="0" value="${item?.opening_qty ?? 0}" ${isAlter ? 'readonly' : ''}>
            </div>
            <div class="mailing-row">
              <label for="item-opening-rate">Rate per unit (₹)</label><span>:</span>
              <input id="item-opening-rate" name="opening_rate" type="number" step="0.01" min="0" value="${item?.opening_rate ? (item.opening_rate / 100).toFixed(2) : '0.00'}" ${isAlter ? 'readonly' : ''}>
            </div>
            <div class="mailing-row">
              <label for="item-opening-val">Value (₹)</label><span>:</span>
              <input id="item-opening-val" name="opening_val" type="text" readonly value="${item?.opening_val ? (item.opening_val / 100).toFixed(2) : '0.00'}">
            </div>
            <div class="mailing-row">
              <label for="item-godown">Godown</label><span>:</span>
              <select id="item-godown" name="godown_id" ${isAlter ? 'disabled' : ''}>
                ${godowns.map(g => `
                  <option value="${g.id}" ${(item?.godown_id ?? defaultGodownId) === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>
                `).join('')}
              </select>
            </div>
            ${isAlter ? '<p class="selection-note">Opening balance can only be set during item creation.</p>' : ''}
          </section>
        </div>
        <div id="stock-item-error" class="ledger-error" role="alert"></div>
        ${isAlter ? '<div class="details-commands master-delete-container"><button type="button" id="delete-stock-item" class="master-delete-btn">Delete Stock Item (Alt+D)</button></div>' : ''}
      </form>`;

      const qtyInput = main.querySelector('#item-opening-qty');
      const rateInput = main.querySelector('#item-opening-rate');
      const valInput = main.querySelector('#item-opening-val');

      function updateOpeningValue() {
        const q = parseFloat(qtyInput.value) || 0;
        const r = parseFloat(rateInput.value) || 0;
        const val = q * r;
        valInput.value = val.toFixed(2);
      }

      if (!isAlter) {
        qtyInput.oninput = updateOpeningValue;
        rateInput.oninput = updateOpeningValue;
      }

      activeMaster = {
        type: 'stock-item',
        mode: isAlter ? 'alter' : 'create',
        item,
        initial: ''
      };
      activeMaster.initial = currentSnapshot();

      const nameInput = main.querySelector('#item-name');
      nameInput.focus();

      if (isAlter) {
        main.querySelector('#delete-stock-item')?.addEventListener('click', () => {
          askDialog(`Delete stock item ${item.name}?`, async () => {
            try {
              await api('/api/inventory/stock-items/' + item.id, {method: 'DELETE'});
              hint.textContent = `Deleted ${item.name}`;
              activeMaster = null;
              openStockItemSelector();
            } catch (e) {
              main.querySelector('#stock-item-error').textContent = e.message;
            }
          }, 'Delete');
        });
      }
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  async function saveStockItem() {
    if (busy || !activeMaster || activeMaster.type !== 'stock-item') return;
    const form = main.querySelector('#stock-item-master-form');
    if (!form) return;
    const name = form.name.value.trim();
    const part_number = form.part_number.value.trim();
    const stock_group_id = Number(form.stock_group_id.value) || null;
    const unit_id = Number(form.unit_id.value) || null;
    const hsn_sac = form.hsn_sac.value.trim();
    const taxability = form.taxability.value;
    const gst_rate = Number(form.gst_rate.value) || 0;
    const opening_qty = parseFloat(form.opening_qty?.value) || 0;
    const opening_rate_rupees = parseFloat(form.opening_rate?.value) || 0;
    const opening_rate = Math.round(opening_rate_rupees * 100);
    const godown_id = Number(form.godown_id?.value) || null;
    const errorBox = main.querySelector('#stock-item-error');
    errorBox.textContent = '';

    if (!name) {
      errorBox.textContent = 'Enter a stock item name.';
      form.name.focus();
      return;
    }
    if (!unit_id) {
      errorBox.textContent = 'Select a unit of measurement.';
      form.unit_id.focus();
      return;
    }

    busy = true;
    try {
      if (activeMaster.mode === 'create') {
        const payload = {
          name,
          part_number,
          stock_group_id,
          unit_id,
          hsn_sac,
          taxability,
          gst_rate,
          opening_qty,
          opening_rate,
          godown_id
        };
        await api('/api/inventory/stock-items', {method: 'POST', body: JSON.stringify(payload)});
        hint.textContent = `Saved Stock Item ${name}`;
        activeMaster = null;
        openStockItemForm();
      } else {
        const payload = {
          name,
          part_number,
          stock_group_id,
          unit_id,
          hsn_sac,
          taxability,
          gst_rate
        };
        await api('/api/inventory/stock-items/' + activeMaster.item.id, {method: 'PUT', body: JSON.stringify(payload)});
        hint.textContent = `Updated Stock Item ${name}`;
        activeMaster = null;
        openStockItemSelector();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    } finally {
      busy = false;
    }
  }

  // ==========================================
  // NAVIGATION & KEYBOARD
  // ==========================================

  function goBack() {
    const v = getView();
    if (['unit-form', 'godown-form', 'stock-group-form', 'stock-item-form'].includes(v)) {
      const back = () => {
        const wasAlter = activeMaster?.mode === 'alter';
        const type = activeMaster?.type;
        activeMaster = null;
        if (wasAlter) {
          if (type === 'unit') openUnitSelector();
          else if (type === 'godown') openGodownSelector();
          else if (type === 'stock-group') openStockGroupSelector();
          else if (type === 'stock-item') openStockItemSelector();
        } else {
          openMastersMenu('create');
        }
      };
      if (isFormDirty()) {
        askDialog('Discard unsaved master changes?', back, 'Discard');
      } else {
        back();
      }
      return true;
    }
    if (['unit-selector', 'godown-selector', 'stock-group-selector', 'stock-item-selector'].includes(v)) {
      openMastersMenu('alter');
      return true;
    }
    return false;
  }

  function onKey(event) {
    const v = getView();
    if (!['unit-form', 'godown-form', 'stock-group-form', 'stock-item-form', 'unit-selector', 'godown-selector', 'stock-group-selector', 'stock-item-selector'].includes(v)) {
      return false;
    }

    if (busy) {
      event.preventDefault();
      return true;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      if (v === 'unit-form') saveUnit();
      else if (v === 'godown-form') saveGodown();
      else if (v === 'stock-group-form') saveStockGroup();
      else if (v === 'stock-item-form') saveStockItem();
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      goBack();
      return true;
    }

    if (event.key === 'Enter' && ['unit-form', 'godown-form', 'stock-group-form', 'stock-item-form'].includes(v)) {
      if (event.target.closest('button')) return false;
      event.preventDefault();
      const form = main.querySelector('form');
      if (!form) return true;
      const elements = Array.from(form.elements).filter(el => !el.disabled && el.type !== 'hidden');
      const idx = elements.indexOf(document.activeElement);
      if (idx !== -1 && idx < elements.length - 1) {
        elements[idx + 1].focus();
      } else {
        if (v === 'unit-form') askDialog('Accept this unit?', saveUnit);
        else if (v === 'godown-form') askDialog('Accept this godown?', saveGodown);
        else if (v === 'stock-group-form') askDialog('Accept this stock group?', saveStockGroup);
        else if (v === 'stock-item-form') askDialog('Accept this stock item?', saveStockItem);
      }
      return true;
    }

    return false;
  }

  return {
    openUnitForm,
    openUnitSelector,
    openGodownForm,
    openGodownSelector,
    openStockGroupForm,
    openStockGroupSelector,
    openStockItemForm,
    openStockItemSelector,
    saveUnit,
    saveGodown,
    saveStockGroup,
    saveStockItem,
    goBack,
    onKey,
    isDirty: isFormDirty
  };
}
