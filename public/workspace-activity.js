// Counts complete application requests without choosing or queuing navigation.
export function createActivityTracker(onChange=()=>{}) {
  let count=0;
  onChange(count);
  return {
    pending:()=>count,
    async run(task) {
      count+=1;onChange(count);
      try { return await task(); }
      finally { count-=1;onChange(count); }
    }
  };
}
