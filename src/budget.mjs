// A casino's time budget. One that exceeds it is written as "timeout" and its worker moves on, but the session it
// holds would stay open: on the local plan, a Chrome per hung casino. attempt() registers each browser it opens under
// the job's id and removes it when it closes the browser itself; the timeout branch closes the one still registered,
// and a browser the timed-out casino's run opens afterwards is closed at once.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A session Browserless already killed may never answer close().
const close = (b) => Promise.race([Promise.resolve().then(() => b.close()).catch(() => {}), sleep(10000)]);

export function sessions() {
  const open = new Map(), over = new Set();
  return {
    /** Registers a job's browser; a job already timed out gets its browser closed and an error instead. */
    async add(id, browser) {
      if (over.has(id)) { await close(browser); throw new Error("casino timed out"); }
      open.set(id, browser);
    },
    /** The job closed this browser itself. */
    remove(id, browser) { if (open.get(id) === browser) open.delete(id); },
    /** Has the job timed out? Its run should start no more sessions. */
    ended: (id) => over.has(id),
    /** The job timed out: close its open browser. */
    async end(id) {
      over.add(id);
      const b = open.get(id);
      open.delete(id);
      if (b) await close(b);
    },
  };
}

const LATE = Symbol("late");
/** The job's row, or `timeoutRow()` once `budgetMs` has passed, after closing the job's open browser. */
export async function withBudget(id, work, budgetMs, live, timeoutRow) {
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(LATE), budgetMs); });
  const row = await Promise.race([work, late]);
  clearTimeout(timer);
  if (row !== LATE) return row;
  await live.end(id);
  return timeoutRow();
}
