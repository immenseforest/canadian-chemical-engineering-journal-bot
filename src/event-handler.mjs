// EventEmitter does not await async listeners. Catch their rejections explicitly.
export function guardedListener(handler,report){
  return (...args)=>Promise.resolve().then(()=>handler(...args)).catch(report);
}
