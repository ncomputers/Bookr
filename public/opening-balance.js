import {formatRupees,formatBalance,inputRupees,parseRupees} from './entry-values.js';
import {editOpeningBills} from './opening-bills.js';

// Reused master opening editor. Parties use full bill-wise breakup in their
// normal Dr/Cr direction; a draft may be incomplete until separate acceptance.
export const supportsOpeningBalance=kind=>['cash','bank','capital','customer','supplier'].includes(kind);
export const partyOpening=kind=>['customer','supplier'].includes(kind);
export function createOpeningBalanceEditor({host,summary,ledger,getLedgers,getName=()=>ledger?.name ?? 'Ledger',escapeHtml,onError=()=>{}}){
  host.className='opening-balance opening-editor';
  host.innerHTML='<label for="ledger-opening-amount">Opening Balance</label><strong>(on 1-Apr-26) :</strong><div class="opening-controls"><input id="ledger-opening-amount" inputmode="decimal" maxlength="20" aria-label="Opening balance in rupees" aria-describedby="opening-balance-warning"><select id="ledger-opening-side" aria-label="Opening balance side"><option value="Dr">Dr</option><option value="Cr">Cr</option></select></div><span id="opening-unavailable">0.00</span><p id="opening-balance-warning" role="status" hidden></p>';
  summary.innerHTML='<strong>Total Opening Balance</strong><div class="opening-total-line"><b>Debit</b><b id="opening-debit"></b></div><div class="opening-total-line"><b>Credit</b><b id="opening-credit"></b></div><div class="opening-total-line opening-total-difference"><b>Difference</b><b id="opening-difference"></b></div>';
  const amount=host.querySelector('#ledger-opening-amount'),side=host.querySelector('#ledger-opening-side'),controls=host.querySelector('.opening-controls'),unavailable=host.querySelector('#opening-unavailable'),warning=host.querySelector('#opening-balance-warning');
  const billButton=document.createElement('button');billButton.id='ledger-opening-bills';billButton.type='button';billButton.textContent='Bill-wise Details';const billSummary=document.createElement('span');billSummary.id='opening-bill-summary';warning.before(billButton,billSummary);
  // Canonical draft shape keeps unspecified terms identical before and after
  // an unchanged child-dialog acceptance, while preserving explicit zero days.
  const draftBill=row=>({...(row.id==null?{}:{id:row.id}),reference:row.reference,date:row.date,amount:row.amount,terms:structuredClone(row.terms ?? null)});
  let bills=(ledger?.opening_bills ?? []).map(draftBill);
  const original=ledger?.opening_balance ?? 0;
  amount.value=original?inputRupees(Math.abs(original)):'';
  side.value=original<0?'Cr':original>0?'Dr':['capital','supplier'].includes(ledger?.kind)?'Cr':'Dr';
  let enabled=false,disabled=false,currentKind=ledger?.kind;
  let reviewed=ledger?ledger.kind+':'+Math.abs(original):'';
  function read(){
    if(!enabled)return 0;
    const text=amount.value.trim();
    if(!text || /^0+(?:\.0{1,2})?$/.test(text))return 0;
    return parseRupees(text)*(side.value==='Cr'?-1:1);
  }
  function updateSummary(){
    const values=getLedgers().filter(row=>row.id!==ledger?.id).map(row=>row.opening_balance ?? 0);
    try{values.push(read());}catch{values.push(0);}
    const debit=values.reduce((sum,value)=>sum+Math.max(value,0),0),credit=values.reduce((sum,value)=>sum+Math.max(-value,0),0),difference=debit-credit;
    summary.querySelector('#opening-debit').textContent=formatRupees(debit)+' Dr';
    summary.querySelector('#opening-credit').textContent=formatRupees(credit)+' Cr';
    summary.querySelector('#opening-difference').textContent=difference?formatBalance(difference):formatRupees(0);
    summary.classList.toggle('opening-unbalanced',difference!==0);
    warning.hidden=difference===0;
    warning.textContent=difference?'Difference in opening balances: '+formatBalance(difference)+'. Complete the other opening balances.':'';
    billSummary.textContent=bills.length?bills.length+' opening reference(s)':'';
  }
  function setDisabled(value){disabled=value;amount.disabled=disabled || !enabled;side.disabled=disabled || !enabled || partyOpening(currentKind);billButton.disabled=disabled || !partyOpening(currentKind);}
  function setKind(kind){
    const changed=kind!==currentKind;currentKind=kind;enabled=supportsOpeningBalance(kind);
    if(partyOpening(kind) || (changed && !amount.value.trim()))side.value=['capital','supplier'].includes(kind)?'Cr':'Dr';
    billButton.hidden=!partyOpening(kind);billSummary.hidden=!partyOpening(kind);
    controls.hidden=!enabled;unavailable.hidden=enabled;setDisabled(disabled);updateSummary();
  }
  function focusError(){amount.setAttribute('aria-invalid','true');amount.focus();}
  function showBills(selectedId=null){
    if(disabled || !partyOpening(currentKind) || document.querySelector('dialog'))return;
    let value;try{value=read();if(!value)throw new Error('Enter an opening balance before adding opening references.');}catch(error){onError(error.message);focusError();return;}
    editOpeningBills({name:getName(),amount:Math.abs(value),side:currentKind==='supplier'?'Cr':'Dr',bills,selectedId,escapeHtml,onDone:next=>{bills=next.map(draftBill);reviewed=currentKind+':'+Math.abs(value);updateSummary();billButton.focus();}});
  }
  function billsReady(){const value=read();return !partyOpening(currentKind) || !value || (bills.length>0 && reviewed===currentKind+':'+Math.abs(value) && bills.reduce((sum,row)=>sum+row.amount,0)===Math.abs(value));}
  billButton.onclick=()=>showBills();
  amount.addEventListener('keydown',event=>{if(event.key!=='Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !partyOpening(currentKind))return;let value;try{value=read();}catch{value=true;}if(!value)return;event.preventDefault();event.stopPropagation();showBills();});
  amount.addEventListener('input',()=>{amount.removeAttribute('aria-invalid');updateSummary();});side.addEventListener('change',updateSummary);
  return {read,setKind,setDisabled,showBills,billsReady,billValues:()=>read()?structuredClone(bills):[],snapshot:()=>({amount:enabled?amount.value:'',side:enabled?side.value:'',...(partyOpening(currentKind)?{bills:structuredClone(bills)}:{})}),focusError};
}
