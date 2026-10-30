export function createAccountingMasters({
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
  let activeMaster = null; // {type: 'group'|'cost-category'|'cost-centre', mode: 'create'|'alter', item: object|null, initial: string}

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
  // 1. GROUPS MASTER
  // ==========================================

  async function openGroupSelector() {
    if (busy) return;
    busy = true;
    try {
      const groups = await api('/api/groups');
      markScreen('Select Group', 'group-selector', 'Select group to alter · ↑ ↓ Enter · Esc: back');
      main.innerHTML = `<section class="ledger-selector" aria-label="Select group">
        <label for="group-search">Name of Group</label>
        <input id="group-search" type="text" autocomplete="off" aria-controls="group-options">
        <div class="selection-heading">List of Groups</div>
        <div id="group-options" role="listbox" aria-label="Groups"></div>
        <p class="selection-note">Built-in and custom accounting groups · ${groups.length} groups</p>
      </section>`;

      let candidates = [...groups];
      let selectedIdx = 0;
      const search = main.querySelector('#group-search');
      const options = main.querySelector('#group-options');

      function renderOptions() {
        const query = search.value.trim().toLowerCase();
        candidates = groups.filter(g => `${g.name} ${g.alias || ''}`.toLowerCase().includes(query));
        selectedIdx = Math.max(0, Math.min(selectedIdx, candidates.length - 1));
        options.innerHTML = candidates.length
          ? candidates.map((g, i) => `
            <button type="button" role="option" class="${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
              ${escapeHtml(g.name)}${g.alias ? ` <small>${escapeHtml(g.alias)}</small>` : ''}
              ${g.is_builtin ? '<small>(Built-in)</small>' : ''}
            </button>
          `).join('')
          : '<p class="no-ledgers">No matching groups found.</p>';

        options.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            selectedIdx = Number(btn.dataset.idx);
            openGroupForm(candidates[selectedIdx]);
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
          if (candidates[selectedIdx]) openGroupForm(candidates[selectedIdx]);
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

  async function openGroupForm(group = null) {
    if (busy) return;
    busy = true;
    try {
      const groups = await api('/api/groups');
      const isAlter = Boolean(group);
      markScreen(
        isAlter ? 'Group Alteration' : 'Group Creation',
        'group-form',
        'Enter: next · Shift+Tab: back · Ctrl+A: save · Esc: back'
      );

      main.innerHTML = `<form id="group-master-form" novalidate autocomplete="off">
        <div class="ledger-identity">
          <div class="identity-fields">
            <div class="identity-row">
              <label for="group-name">Name</label><span>:</span>
              <input id="group-name" name="name" maxlength="120" required value="${escapeHtml(group?.name ?? '')}" ${group?.is_builtin ? 'readonly' : ''} spellcheck="false">
            </div>
            <div class="identity-row">
              <label for="group-alias"><i>(alias)</i></label><span>:</span>
              <input id="group-alias" name="alias" maxlength="120" value="${escapeHtml(group?.alias ?? '')}" ${group?.is_builtin ? 'readonly' : ''} spellcheck="false">
            </div>
          </div>
        </div>
        <div class="ledger-detail-columns">
          <section class="ledger-accounting" aria-label="Group details">
            <div class="accounting-row">
              <label for="group-parent">Under</label><span>:</span>
              <div>
                <select id="group-parent" name="parent_id" ${group?.is_builtin ? 'disabled' : ''}>
                  <option value="">Primary</option>
                  ${groups.filter(g => !group || g.id !== group.id).map(g => `
                    <option value="${g.id}" ${group?.parent_id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="accounting-row" id="group-nature-row">
              <label for="group-nature">Nature of Group</label><span>:</span>
              <div>
                <select id="group-nature" name="nature" ${group?.is_builtin ? 'disabled' : ''}>
                  <option value="Assets" ${group?.nature === 'Assets' ? 'selected' : ''}>Assets</option>
                  <option value="Liabilities" ${group?.nature === 'Liabilities' ? 'selected' : ''}>Liabilities</option>
                  <option value="Expenses" ${group?.nature === 'Expenses' ? 'selected' : ''}>Expenses</option>
                  <option value="Income" ${group?.nature === 'Income' ? 'selected' : ''}>Income</option>
                </select>
              </div>
            </div>
            ${group?.is_builtin ? '<p class="selection-note">Built-in standard groups cannot be modified or deleted.</p>' : ''}
          </section>
        </div>
        <div id="group-error" class="ledger-error" role="alert"></div>
        ${isAlter && !group.is_builtin ? '<div class="details-commands" style="padding:10px;"><button type="button" id="delete-group" style="background:#fee;border:1px solid #d88;padding:4px 8px;cursor:pointer;">Delete Group (Alt+D)</button></div>' : ''}
      </form>`;

      const parentSelect = main.querySelector('#group-parent');
      const natureRow = main.querySelector('#group-nature-row');
      const updateNatureVis = () => {
        natureRow.hidden = Boolean(parentSelect.value);
      };
      parentSelect.onchange = updateNatureVis;
      updateNatureVis();

      activeMaster = {
        type: 'group',
        mode: isAlter ? 'alter' : 'create',
        item: group,
        initial: ''
      };
      activeMaster.initial = currentSnapshot();

      const nameInput = main.querySelector('#group-name');
      nameInput.focus();

      if (isAlter && !group.is_builtin) {
        main.querySelector('#delete-group')?.addEventListener('click', () => {
          askDialog(`Delete group ${group.name}?`, async () => {
            try {
              await api('/api/groups/' + group.id, {method: 'DELETE'});
              hint.textContent = `Deleted ${group.name}`;
              activeMaster = null;
              openGroupSelector();
            } catch (e) {
              main.querySelector('#group-error').textContent = e.message;
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

  async function saveGroup() {
    if (busy || !activeMaster || activeMaster.type !== 'group') return;
    const form = main.querySelector('#group-master-form');
    if (!form) return;
    const name = form.name.value.trim();
    const alias = form.alias.value.trim();
    const parentVal = form.parent_id?.value;
    const parentId = parentVal ? Number(parentVal) : null;
    const nature = form.nature?.value;
    const errorBox = main.querySelector('#group-error');
    errorBox.textContent = '';

    if (!name) {
      errorBox.textContent = 'Enter a group name.';
      form.name.focus();
      return;
    }

    busy = true;
    try {
      if (activeMaster.mode === 'create') {
        const payload = {name, alias, parent_id: parentId};
        if (!parentId) payload.nature = nature;
        await api('/api/groups', {method: 'POST', body: JSON.stringify(payload)});
        hint.textContent = `Saved Group ${name}`;
        activeMaster = null;
        openGroupForm();
      } else {
        if (activeMaster.item.is_builtin) {
          activeMaster = null;
          openMastersMenu('alter');
          return;
        }
        const payload = {revision: activeMaster.item.revision, name, alias, parent_id: parentId};
        if (!parentId) payload.nature = nature;
        await api('/api/groups/' + activeMaster.item.id, {method: 'PUT', body: JSON.stringify(payload)});
        hint.textContent = `Updated Group ${name}`;
        activeMaster = null;
        openGroupSelector();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    } finally {
      busy = false;
    }
  }

  // ==========================================
  // 2. COST CATEGORIES MASTER
  // ==========================================

  async function openCostCategorySelector() {
    if (busy) return;
    busy = true;
    try {
      const categories = await api('/api/cost-categories');
      markScreen('Select Cost Category', 'cost-category-selector', 'Select category to alter · ↑ ↓ Enter · Esc: back');
      main.innerHTML = `<section class="ledger-selector" aria-label="Select cost category">
        <label for="category-search">Name of Cost Category</label>
        <input id="category-search" type="text" autocomplete="off" aria-controls="category-options">
        <div class="selection-heading">List of Cost Categories</div>
        <div id="category-options" role="listbox" aria-label="Cost Categories"></div>
        <p class="selection-note">${categories.length} saved cost categories</p>
      </section>`;

      let candidates = [...categories];
      let selectedIdx = 0;
      const search = main.querySelector('#category-search');
      const options = main.querySelector('#category-options');

      function renderOptions() {
        const query = search.value.trim().toLowerCase();
        candidates = categories.filter(c => `${c.name} ${c.alias || ''}`.toLowerCase().includes(query));
        selectedIdx = Math.max(0, Math.min(selectedIdx, candidates.length - 1));
        options.innerHTML = candidates.length
          ? candidates.map((c, i) => `
            <button type="button" role="option" class="${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
              ${escapeHtml(c.name)}${c.alias ? ` <small>${escapeHtml(c.alias)}</small>` : ''}
              ${c.is_builtin ? '<small>(Primary)</small>' : ''}
            </button>
          `).join('')
          : '<p class="no-ledgers">No cost categories match.</p>';

        options.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            selectedIdx = Number(btn.dataset.idx);
            openCostCategoryForm(candidates[selectedIdx]);
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
          if (candidates[selectedIdx]) openCostCategoryForm(candidates[selectedIdx]);
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

  async function openCostCategoryForm(category = null) {
    if (busy) return;
    const isAlter = Boolean(category);
    markScreen(
      isAlter ? 'Cost Category Alteration' : 'Cost Category Creation',
      'cost-category-form',
      'Enter: next · Shift+Tab: back · Ctrl+A: save · Esc: back'
    );

    main.innerHTML = `<form id="category-master-form" novalidate autocomplete="off">
      <div class="ledger-identity">
        <div class="identity-fields">
          <div class="identity-row">
            <label for="category-name">Name</label><span>:</span>
            <input id="category-name" name="name" maxlength="120" required value="${escapeHtml(category?.name ?? '')}" ${category?.is_builtin ? 'readonly' : ''} spellcheck="false">
          </div>
          <div class="identity-row">
            <label for="category-alias"><i>(alias)</i></label><span>:</span>
            <input id="category-alias" name="alias" maxlength="120" value="${escapeHtml(category?.alias ?? '')}" ${category?.is_builtin ? 'readonly' : ''} spellcheck="false">
          </div>
        </div>
      </div>
      <div class="ledger-detail-columns">
        <section class="ledger-accounting" aria-label="Cost category options">
          <div class="accounting-row">
            <label for="cat-revenue">Allocate Revenue items</label><span>:</span>
            <div>
              <select id="cat-revenue" name="allocate_revenue" ${category?.is_builtin ? 'disabled' : ''}>
                <option value="1" ${category?.allocate_revenue !== 0 ? 'selected' : ''}>Yes</option>
                <option value="0" ${category?.allocate_revenue === 0 ? 'selected' : ''}>No</option>
              </select>
            </div>
          </div>
          <div class="accounting-row">
            <label for="cat-non-revenue">Allocate Non-Revenue items</label><span>:</span>
            <div>
              <select id="cat-non-revenue" name="allocate_non_revenue" ${category?.is_builtin ? 'disabled' : ''}>
                <option value="0" ${!category?.allocate_non_revenue ? 'selected' : ''}>No</option>
                <option value="1" ${category?.allocate_non_revenue ? 'selected' : ''}>Yes</option>
              </select>
            </div>
          </div>
          ${category?.is_builtin ? '<p class="selection-note">Primary Cost Category cannot be renamed or altered.</p>' : ''}
        </section>
      </div>
      <div id="category-error" class="ledger-error" role="alert"></div>
      ${isAlter && !category.is_builtin ? '<div class="details-commands" style="padding:10px;"><button type="button" id="delete-category" style="background:#fee;border:1px solid #d88;padding:4px 8px;cursor:pointer;">Delete Category (Alt+D)</button></div>' : ''}
    </form>`;

    activeMaster = {
      type: 'cost-category',
      mode: isAlter ? 'alter' : 'create',
      item: category,
      initial: ''
    };
    activeMaster.initial = currentSnapshot();

    const nameInput = main.querySelector('#category-name');
    nameInput.focus();

    if (isAlter && !category.is_builtin) {
      main.querySelector('#delete-category')?.addEventListener('click', () => {
        askDialog(`Delete cost category ${category.name}?`, async () => {
          try {
            await api('/api/cost-categories/' + category.id, {method: 'DELETE'});
            hint.textContent = `Deleted ${category.name}`;
            activeMaster = null;
            openCostCategorySelector();
          } catch (e) {
            main.querySelector('#category-error').textContent = e.message;
          }
        }, 'Delete');
      });
    }
  }

  async function saveCostCategory() {
    if (busy || !activeMaster || activeMaster.type !== 'cost-category') return;
    const form = main.querySelector('#category-master-form');
    if (!form) return;
    const name = form.name.value.trim();
    const alias = form.alias.value.trim();
    const revVal = form.allocate_revenue?.value;
    const nonRevVal = form.allocate_non_revenue?.value;
    const errorBox = main.querySelector('#category-error');
    errorBox.textContent = '';

    if (!name) {
      errorBox.textContent = 'Enter a cost category name.';
      form.name.focus();
      return;
    }

    busy = true;
    try {
      if (activeMaster.mode === 'create') {
        const payload = {
          name,
          alias,
          allocate_revenue: revVal === '1' ? 1 : 0,
          allocate_non_revenue: nonRevVal === '1' ? 1 : 0
        };
        await api('/api/cost-categories', {method: 'POST', body: JSON.stringify(payload)});
        hint.textContent = `Saved Cost Category ${name}`;
        activeMaster = null;
        openCostCategoryForm();
      } else {
        if (activeMaster.item.is_builtin) {
          activeMaster = null;
          openMastersMenu('alter');
          return;
        }
        const payload = {
          revision: activeMaster.item.revision,
          name,
          alias,
          allocate_revenue: revVal === '1' ? 1 : 0,
          allocate_non_revenue: nonRevVal === '1' ? 1 : 0
        };
        await api('/api/cost-categories/' + activeMaster.item.id, {method: 'PUT', body: JSON.stringify(payload)});
        hint.textContent = `Updated Cost Category ${name}`;
        activeMaster = null;
        openCostCategorySelector();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    } finally {
      busy = false;
    }
  }

  // ==========================================
  // 3. COST CENTRES MASTER
  // ==========================================

  async function openCostCentreSelector() {
    if (busy) return;
    busy = true;
    try {
      const centres = await api('/api/cost-centres');
      markScreen('Select Cost Centre', 'cost-centre-selector', 'Select cost centre to alter · ↑ ↓ Enter · Esc: back');
      main.innerHTML = `<section class="ledger-selector" aria-label="Select cost centre">
        <label for="centre-search">Name of Cost Centre</label>
        <input id="centre-search" type="text" autocomplete="off" aria-controls="centre-options">
        <div class="selection-heading">List of Cost Centres</div>
        <div id="centre-options" role="listbox" aria-label="Cost Centres"></div>
        <p class="selection-note">${centres.length} saved cost centres</p>
      </section>`;

      let candidates = [...centres];
      let selectedIdx = 0;
      const search = main.querySelector('#centre-search');
      const options = main.querySelector('#centre-options');

      function renderOptions() {
        const query = search.value.trim().toLowerCase();
        candidates = centres.filter(c => `${c.name} ${c.alias || ''} ${c.category_name || ''}`.toLowerCase().includes(query));
        selectedIdx = Math.max(0, Math.min(selectedIdx, candidates.length - 1));
        options.innerHTML = candidates.length
          ? candidates.map((c, i) => `
            <button type="button" role="option" class="${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
              ${escapeHtml(c.name)}${c.alias ? ` <small>${escapeHtml(c.alias)}</small>` : ''}
              <small>(${escapeHtml(c.category_name)})</small>
            </button>
          `).join('')
          : '<p class="no-ledgers">No cost centres match.</p>';

        options.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            selectedIdx = Number(btn.dataset.idx);
            openCostCentreForm(candidates[selectedIdx]);
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
          if (candidates[selectedIdx]) openCostCentreForm(candidates[selectedIdx]);
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

  async function openCostCentreForm(centre = null) {
    if (busy) return;
    busy = true;
    try {
      const [categories, allCentres] = await Promise.all([
        api('/api/cost-categories'),
        api('/api/cost-centres')
      ]);
      const isAlter = Boolean(centre);
      markScreen(
        isAlter ? 'Cost Centre Alteration' : 'Cost Centre Creation',
        'cost-centre-form',
        'Enter: next · Shift+Tab: back · Ctrl+A: save · Esc: back'
      );

      const defaultCatId = centre ? centre.category_id : (categories[0]?.id ?? 1);

      main.innerHTML = `<form id="centre-master-form" novalidate autocomplete="off">
        <div class="ledger-identity">
          <div class="identity-fields">
            <div class="identity-row">
              <label for="centre-category">Category</label><span>:</span>
              <select id="centre-category" name="category_id">
                ${categories.map(c => `
                  <option value="${c.id}" ${c.id === defaultCatId ? 'selected' : ''}>${escapeHtml(c.name)}</option>
                `).join('')}
              </select>
            </div>
            <div class="identity-row">
              <label for="centre-name">Name</label><span>:</span>
              <input id="centre-name" name="name" maxlength="120" required value="${escapeHtml(centre?.name ?? '')}" spellcheck="false">
            </div>
            <div class="identity-row">
              <label for="centre-alias"><i>(alias)</i></label><span>:</span>
              <input id="centre-alias" name="alias" maxlength="120" value="${escapeHtml(centre?.alias ?? '')}" spellcheck="false">
            </div>
          </div>
        </div>
        <div class="ledger-detail-columns">
          <section class="ledger-accounting" aria-label="Hierarchy">
            <div class="accounting-row">
              <label for="centre-parent">Under</label><span>:</span>
              <div>
                <select id="centre-parent" name="parent_id">
                  <option value="">Primary</option>
                </select>
              </div>
            </div>
          </section>
        </div>
        <div id="centre-error" class="ledger-error" role="alert"></div>
        ${isAlter ? '<div class="details-commands" style="padding:10px;"><button type="button" id="delete-centre" style="background:#fee;border:1px solid #d88;padding:4px 8px;cursor:pointer;">Delete Cost Centre (Alt+D)</button></div>' : ''}
      </form>`;

      const catSelect = main.querySelector('#centre-category');
      const parentSelect = main.querySelector('#centre-parent');

      const updateParentOptions = () => {
        const selectedCat = Number(catSelect.value);
        const candidates = allCentres.filter(c => c.category_id === selectedCat && (!centre || c.id !== centre.id));
        parentSelect.innerHTML = `<option value="">Primary</option>${candidates.map(c => `
          <option value="${c.id}" ${centre?.parent_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>
        `).join('')}`;
      };

      catSelect.onchange = updateParentOptions;
      updateParentOptions();

      activeMaster = {
        type: 'cost-centre',
        mode: isAlter ? 'alter' : 'create',
        item: centre,
        initial: ''
      };
      activeMaster.initial = currentSnapshot();

      const nameInput = main.querySelector('#centre-name');
      nameInput.focus();

      if (isAlter) {
        main.querySelector('#delete-centre')?.addEventListener('click', () => {
          askDialog(`Delete cost centre ${centre.name}?`, async () => {
            try {
              await api('/api/cost-centres/' + centre.id, {method: 'DELETE'});
              hint.textContent = `Deleted ${centre.name}`;
              activeMaster = null;
              openCostCentreSelector();
            } catch (e) {
              main.querySelector('#centre-error').textContent = e.message;
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

  async function saveCostCentre() {
    if (busy || !activeMaster || activeMaster.type !== 'cost-centre') return;
    const form = main.querySelector('#centre-master-form');
    if (!form) return;
    const categoryId = Number(form.category_id.value);
    const name = form.name.value.trim();
    const alias = form.alias.value.trim();
    const parentVal = form.parent_id.value;
    const parentId = parentVal ? Number(parentVal) : null;
    const errorBox = main.querySelector('#centre-error');
    errorBox.textContent = '';

    if (!name) {
      errorBox.textContent = 'Enter a cost centre name.';
      form.name.focus();
      return;
    }

    busy = true;
    try {
      if (activeMaster.mode === 'create') {
        const payload = {category_id: categoryId, parent_id: parentId, name, alias};
        await api('/api/cost-centres', {method: 'POST', body: JSON.stringify(payload)});
        hint.textContent = `Saved Cost Centre ${name}`;
        activeMaster = null;
        openCostCentreForm();
      } else {
        const payload = {
          revision: activeMaster.item.revision,
          category_id: categoryId,
          parent_id: parentId,
          name,
          alias
        };
        await api('/api/cost-centres/' + activeMaster.item.id, {method: 'PUT', body: JSON.stringify(payload)});
        hint.textContent = `Updated Cost Centre ${name}`;
        activeMaster = null;
        openCostCentreSelector();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    } finally {
      busy = false;
    }
  }

  // ==========================================
  // NAVIGATION & KEYBOARD HANDLING
  // ==========================================

  function goBack() {
    const v = getView();
    if (['group-form', 'cost-category-form', 'cost-centre-form'].includes(v)) {
      const exitForm = () => {
        const mode = activeMaster?.mode ?? 'create';
        activeMaster = null;
        if (mode === 'create') openMastersMenu('create');
        else if (v === 'group-form') openGroupSelector();
        else if (v === 'cost-category-form') openCostCategorySelector();
        else if (v === 'cost-centre-form') openCostCentreSelector();
      };
      if (isFormDirty()) {
        askDialog('Discard unsaved changes?', exitForm, 'Discard');
      } else {
        exitForm();
      }
      return true;
    }
    if (['group-selector', 'cost-category-selector', 'cost-centre-selector'].includes(v)) {
      openMastersMenu('alter');
      return true;
    }
    return false;
  }

  function onKey(event) {
    const v = getView();
    if (!['group-form', 'cost-category-form', 'cost-centre-form', 'group-selector', 'cost-category-selector', 'cost-centre-selector'].includes(v)) {
      return false;
    }

    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      if (v === 'group-form') saveGroup();
      else if (v === 'cost-category-form') saveCostCategory();
      else if (v === 'cost-centre-form') saveCostCentre();
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      goBack();
      return true;
    }

    if (event.key === 'Enter' && ['group-form', 'cost-category-form', 'cost-centre-form'].includes(v)) {
      if (event.target.closest('button')) return false;
      event.preventDefault();
      const form = main.querySelector('form');
      if (!form) return true;
      const elements = Array.from(form.elements).filter(el => !el.disabled && el.type !== 'hidden');
      const idx = elements.indexOf(document.activeElement);
      if (idx !== -1 && idx < elements.length - 1) {
        elements[idx + 1].focus();
      } else {
        if (v === 'group-form') askDialog('Accept this group?', saveGroup);
        else if (v === 'cost-category-form') askDialog('Accept this cost category?', saveCostCategory);
        else if (v === 'cost-centre-form') askDialog('Accept this cost centre?', saveCostCentre);
      }
      return true;
    }

    return false;
  }

  return {
    openGroupForm,
    openGroupSelector,
    openCostCategoryForm,
    openCostCategorySelector,
    openCostCentreForm,
    openCostCentreSelector,
    saveGroup,
    saveCostCategory,
    saveCostCentre,
    goBack,
    onKey,
    isDirty: isFormDirty
  };
}
