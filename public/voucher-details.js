import { entryDate,parseEntryDate } from './entry-values.js';

// Entry metadata is separate from the two accounting postings.
export function editVoucherDetails({customer,details,escapeHtml,onDone,onCancel,setCaption,purchase=false}) {
  const draft = structuredClone(details);
  draft.dispatch ??= {};
  draft.party ??= {mailing_name:customer.mailing_name || customer.name,address:customer.address || '',state:customer.state || 'Not Applicable',country:customer.country || 'India'};
  function show(stage) {
    document.querySelector('#voucher-details-dialog')?.remove();
    setCaption('Party Details');
    const dialog = document.createElement('dialog');
    dialog.id = 'voucher-details-dialog'; dialog.className = `native-entry-dialog ${stage}-dialog`;
    dialog.setAttribute('aria-labelledby','details-heading'); dialog.dataset.stage = stage;
    const field = (name,label,max=120) => `<div class="detail-row"><label for="detail-${name}">${label}</label><span>:</span><input id="detail-${name}" data-detail="${name}" maxlength="${max}" value="${escapeHtml(stage === 'dispatch' && name === 'bill_date' && draft.dispatch.bill_date ? entryDate(draft.dispatch.bill_date) : draft[stage][name] || '')}"></div>`;
    dialog.innerHTML = `<form novalidate autocomplete="off"><h2 id="details-heading">${stage === 'dispatch' ? 'Dispatch Details' : 'Party Details'}</h2>${stage === 'dispatch' ? `<div class="dispatch-columns"><div class="delivery-note"><label for="detail-delivery_note">Delivery Note No(s)</label><input id="detail-delivery_note" data-detail="delivery_note" maxlength="200" value="${escapeHtml(draft.dispatch.delivery_note || '')}"></div><div>${field('document_no','Dispatch Doc No.')}${field('through','Dispatched through')}${field('destination','Destination')}${field('carrier','Carrier Name/Agent')}<div class="lading-row">${field('bill_of_lading','Bill of Lading/LR-RR No.')} ${field('bill_date','Date',20)}</div>${field('vehicle','Motor Vehicle No.',80)}</div></div>` : `<div class="detail-row"><label for="buyer-name">Buyer (Bill to)</label><span>:</span><input id="buyer-name" value="${escapeHtml(customer.name)}" readonly></div>${field('mailing_name','Mailing Name')}<div class="detail-row address-row"><label for="detail-address">Address</label><span>:</span><textarea id="detail-address" data-detail="address" maxlength="1000" rows="3">${escapeHtml(draft.party.address || '')}</textarea></div><div class="party-region">${field('state','State')}${field('country','Country')}</div>`}<p class="details-error" role="alert"></p><div class="details-commands"><button type="button" data-back>Back <small>Esc</small></button><button type="submit" data-accept>Accept <small>Ctrl+A</small></button></div></form>`;
    if(purchase){
      if(stage==='dispatch'){
        dialog.querySelector('h2').textContent='Receipt Details';
        dialog.querySelector('label[for="detail-delivery_note"]').textContent='Receipt Note No(s)';
        dialog.querySelector('label[for="detail-document_no"]').textContent='Receipt Doc No.';
      }else dialog.querySelector('label[for="buyer-name"]').textContent='Supplier (Bill from)';
    }
    document.body.append(dialog);
    const fields = [...dialog.querySelectorAll('[data-detail]')];
    function collect() {
      const next = Object.fromEntries(fields.map(field => [field.dataset.detail,field.value]));
      if (stage === 'dispatch' && next.bill_date) {
        try { next.bill_date = parseEntryDate(next.bill_date); }
        catch (error) { dialog.querySelector('.details-error').textContent = error.message; dialog.querySelector('#detail-bill_date').focus(); return false; }
      }
      draft[stage] = next; return true;
    }
    function back() {
      if (stage === 'party') collect();
      dialog.close(); dialog.remove();
      if (stage === 'party') show('dispatch'); else { setCaption(null); onCancel(); }
    }
    function accept() {
      if (!collect()) return;
      dialog.close(); dialog.remove();
      if (stage === 'dispatch') show('party'); else { setCaption(null); onDone(draft); }
    }
    dialog.querySelector('form').addEventListener('submit',event => { event.preventDefault(); accept(); });
    dialog.querySelector('[data-back]').addEventListener('click',back);
    dialog.addEventListener('cancel',event => { event.preventDefault(); back(); });
    dialog.addEventListener('keydown',event => {
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); accept(); }
      else if (event.key === 'Enter' && !event.shiftKey && !event.target.closest('button')) {
        event.preventDefault(); event.stopPropagation();
        const index = fields.indexOf(document.activeElement);
        if (index < fields.length-1) fields[index+1].focus(); else accept();
      }
    });
    dialog.showModal(); fields[0].focus();
  }
  show('dispatch');
}
