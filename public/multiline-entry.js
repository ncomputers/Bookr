// Let the browser handle ordinary newline insertion, selection, undo and the
// field's maxlength. An empty final line completes this multiline field.
export function handleMultilineEntry(event,onNext){
  const field=event.target;
  if(event.key!=='Enter' || event.ctrlKey || event.altKey || event.metaKey || field?.tagName!=='TEXTAREA')return false;
  if(event.isComposing)return true;
  const value=field.value,start=field.selectionStart,end=field.selectionEnd;
  const lineStart=value.lastIndexOf('\n',start-1)+1;
  const finalLine=value.indexOf('\n',start)===-1;
  if(!event.shiftKey && start===end && finalLine && value.slice(lineStart).trim()===''){
    event.preventDefault();
    const finished=value.trim()?value.replace(/(?:\n[\t ]*)+$/,''):'';
    if(finished!==value){field.value=finished;field.dispatchEvent(new Event('input',{bubbles:true}));}
    onNext();
  }
  return true;
}
