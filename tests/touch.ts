// Development-only mobile preview: emulate a touch-capable device for desktop QA.
// Production has no forced-touch switch. Actual phone input uses native PointerEvents.
Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:2});
const nativeMatchMedia=window.matchMedia.bind(window);
window.matchMedia=query=>{
  const result=nativeMatchMedia(query);
  if(query==='(any-pointer: coarse)')Object.defineProperty(result,'matches',{value:true});
  return result;
};
// Desktop automation activates buttons with Enter. Treat the resulting click as
// a mobile tap so the real keyboard/touch handoff does not hide the preview pads.
window.addEventListener('click',()=>document.querySelector('#viewport canvas')?.dispatchEvent(
  new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:9000})));
await import('../src/main');
export {};
