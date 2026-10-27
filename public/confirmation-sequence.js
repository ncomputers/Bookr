// Sequence existing shared dialogs while keeping cancellation tied to the
// original edited field, never to a button in a removed preceding dialog.
export function confirmSequence({askDialog,messages,focus,onAccepted}){
 const step=index=>{focus?.();askDialog(messages[index],()=>index+1<messages.length?step(index+1):onAccepted());};
 if(messages.length)step(0);else onAccepted();
}
