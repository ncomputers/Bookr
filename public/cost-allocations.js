import {formatRupees, parseRupees, inputRupees} from './entry-values.js';

export async function editCostAllocations({
  ledger,
  amount,
  existingAllocations = [],
  api,
  escapeHtml,
  setCaption,
  onDone,
  onCancel
}) {
  const previousDialog = document.querySelector('dialog');
  if (previousDialog) previousDialog.close();

  let categories = [];
  let centres = [];
  try {
    const [cats, cents] = await Promise.all([
      api('/api/cost-categories'),
      api('/api/cost-centres')
    ]);
    categories = cats;
    centres = cents;
  } catch (err) {
    categories = [{id: 1, name: 'Primary Cost Category', allocate_revenue: 1, allocate_non_revenue: 0}];
    centres = [];
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'cost-allocations-dialog';
  dialog.className = 'cost-allocations-dialog';

  // Find existing allocation group for this ledger
  const savedGroup = (existingAllocations || []).find(ca => ca.ledger_id === ledger.id);
  let selectedCategoryId = savedGroup?.category_id ?? (categories[0]?.id ?? 1);
  let selectedCategory = categories.find(c => c.id === selectedCategoryId) || categories[0] || {id: 1, name: 'Primary Cost Category'};

  let rows = [];
  if (savedGroup && savedGroup.allocations?.length) {
    rows = savedGroup.allocations.map(a => ({
      centre_id: a.centre_id,
      centre_name: a.centre_name || centres.find(c => c.id === a.centre_id)?.name || '',
      amount: a.amount
    }));
  }

  function getCategoryCentres() {
    return centres.filter(c => c.category_id === selectedCategoryId);
  }

  function calculateTotal() {
    return rows.reduce((sum, r) => sum + (r.amount || 0), 0);
  }

  function render() {
    const total = calculateTotal();
    const remaining = amount - total;
    const balanced = total === amount;

    dialog.innerHTML = `
      <div class="cost-alloc-header">
        <h2>Cost Allocations to: <span>${escapeHtml(ledger.name)}</span></h2>
        <div class="cost-alloc-amount-badge">For: <b>₹ ${formatRupees(amount)}</b></div>
      </div>
      <div class="cost-alloc-body">
        <div class="cost-category-row">
          <label for="cost-category-select">Cost Category:</label>
          <select id="cost-category-select" ${categories.length <= 1 ? 'disabled' : ''}>
            ${categories.map(c => `<option value="${c.id}" ${c.id === selectedCategoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <table class="cost-alloc-table">
          <thead>
            <tr>
              <th>Name of Cost Centre</th>
              <th class="money-col">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="cost-alloc-rows">
            ${rows.map((row, i) => `
              <tr data-row-idx="${i}">
                <td>
                  <input class="cost-centre-input" data-idx="${i}" value="${escapeHtml(row.centre_name)}" placeholder="Choose Cost Centre" autocomplete="off">
                </td>
                <td class="money-col">
                  <input class="cost-amount-input" data-idx="${i}" inputmode="decimal" value="${inputRupees(row.amount)}">
                </td>
                <td>
                  <button type="button" class="cost-remove-btn" data-idx="${i}" title="Remove">✕</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="cost-alloc-add-row">
          <button type="button" id="cost-add-line">+ Add Line</button>
        </div>
      </div>
      <div class="cost-alloc-summary">
        <div class="summary-line"><span>Total:</span> <b id="cost-total">₹ ${formatRupees(total)}</b></div>
        <div class="summary-line"><span>Remaining:</span> <b id="cost-remaining" class="${remaining !== 0 ? 'unbalanced' : 'balanced'}">₹ ${formatRupees(remaining)}</b></div>
      </div>
      <div id="cost-alloc-error" class="ledger-error" role="alert"></div>
      <div class="cost-alloc-actions">
        <button type="button" id="cost-alloc-cancel"><u>E</u>sc: Cancel</button>
        <button type="button" id="cost-alloc-accept" ${balanced ? '' : 'disabled'}><u>A</u>ccept <span>Ctrl+A</span></button>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const errorBox = dialog.querySelector('#cost-alloc-error');

    dialog.querySelector('#cost-category-select')?.addEventListener('change', (e) => {
      selectedCategoryId = Number(e.target.value);
      selectedCategory = categories.find(c => c.id === selectedCategoryId) || categories[0] || {id: 1, name: 'Primary Cost Category'};
      render();
    });

    dialog.querySelector('#cost-add-line')?.addEventListener('click', () => {
      const remaining = amount - calculateTotal();
      rows.push({
        centre_id: null,
        centre_name: '',
        amount: remaining > 0 ? remaining : 0
      });
      render();
      const lastInput = dialog.querySelectorAll('.cost-centre-input');
      if (lastInput.length) lastInput[lastInput.length - 1].focus();
    });

    dialog.querySelectorAll('.cost-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        rows.splice(idx, 1);
        render();
      });
    });

    dialog.querySelectorAll('.cost-amount-input').forEach(input => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.idx);
        try {
          rows[idx].amount = parseRupees(input.value);
        } catch {
          rows[idx].amount = 0;
        }
        const total = calculateTotal();
        const rem = amount - total;
        dialog.querySelector('#cost-total').textContent = `₹ ${formatRupees(total)}`;
        const remEl = dialog.querySelector('#cost-remaining');
        remEl.textContent = `₹ ${formatRupees(rem)}`;
        remEl.className = rem !== 0 ? 'unbalanced' : 'balanced';
        dialog.querySelector('#cost-alloc-accept').disabled = (total !== amount);
        errorBox.textContent = '';
      });
    });

    dialog.querySelectorAll('.cost-centre-input').forEach(input => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.idx);
        rows[idx].centre_name = input.value;
        const name = input.value.trim().toLowerCase();
        const match = centres.find(c => c.name.toLowerCase() === name);
        if (match) {
          rows[idx].centre_id = match.id;
          rows[idx].centre_name = match.name;
        }
      });
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.idx);
        const name = input.value.trim().toLowerCase();
        const match = centres.find(c => c.name.toLowerCase() === name);
        if (match) {
          rows[idx].centre_id = match.id;
          rows[idx].centre_name = match.name;
        }
      });
    });

    function accept() {
      const total = calculateTotal();
      if (total !== amount) {
        errorBox.textContent = 'Mismatch between total Cost Centre Allocation and Ledger Amount';
        return;
      }
      for (const r of rows) {
        if (!r.centre_id) {
          const match = centres.find(c => c.name.toLowerCase() === (r.centre_name || '').trim().toLowerCase());
          if (match) {
            r.centre_id = match.id;
            r.centre_name = match.name;
          } else {
            errorBox.textContent = 'Select a valid Cost Centre for each row.';
            return;
          }
        }
      }

      // Group rows by category_id
      const byCategory = new Map();
      for (const r of rows) {
        const catId = centres.find(c => c.id === r.centre_id)?.category_id ?? selectedCategoryId;
        const list = byCategory.get(catId) ?? [];
        list.push({
          centre_id: r.centre_id,
          centre_name: r.centre_name,
          amount: r.amount
        });
        byCategory.set(catId, list);
      }

      const result = [];
      for (const [catId, allocList] of byCategory) {
        const catObj = categories.find(c => c.id === catId);
        result.push({
          ledger_id: ledger.id,
          category_id: catId,
          category_name: catObj?.name,
          allocations: allocList
        });
      }

      dialog.close();
      dialog.remove();
      onDone(result);
    }

    dialog.querySelector('#cost-alloc-accept')?.addEventListener('click', accept);
    dialog.querySelector('#cost-alloc-cancel')?.addEventListener('click', () => {
      dialog.close();
      dialog.remove();
      onCancel();
    });

    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dialog.close();
        dialog.remove();
        onCancel();
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        accept();
      }
    });
  }

  // If no rows initially, add first row with remaining balance
  if (!rows.length) {
    const available = getCategoryCentres();
    rows.push({
      centre_id: available[0]?.id ?? null,
      centre_name: available[0]?.name ?? '',
      amount: amount
    });
  }

  document.body.appendChild(dialog);
  render();
  dialog.showModal();
}
