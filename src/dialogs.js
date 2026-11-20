// One dialog at a time. The small dialog of index.html (#dialog) is shared by everything that
// asks the user something. A question can come while another dialog is on screen: an AI asks to
// open a file while the user is told where a copy was made, a document's definitions are asked
// about while it is being imported. Shown at once, the second would take the place of the
// first, whose answer then never comes. So a question that returns a promise is shown in its
// turn (inTurn): when the dialogs asked for before it are answered and no other dialog is open.
const box = () => document.querySelector('#dialog');
let turn = Promise.resolve(); // settles when the last question asked for is answered

// resolves when the dialog is closed: at once when it is, else when its `hidden` is set
const closed = () => new Promise((resolve) => {
  if (box().hidden) { resolve(); return; }
  const seen = new MutationObserver(() => { if (box().hidden) { seen.disconnect(); resolve(); } });
  seen.observe(box(), { attributes: true, attributeFilter: ['hidden'] });
});

// show(answer): puts the question on screen (when its turn has come); its buttons call
// answer(value), which closes the dialog. -> a promise of that value. It always settles: a
// dialog closed in any other way (another dialog took its place and was closed) gives `unanswered`.
export function inTurn(show, unanswered = null) {
  const mine = turn.then(closed).then(() => new Promise((resolve) => {
    let done = false;
    const answer = (value) => {
      if (done) return;
      done = true;
      box().hidden = true;
      resolve(value);
    };
    show(answer);
    closed().then(() => answer(unanswered));
  }));
  turn = mine.catch(() => {}); // (a question that could not be shown does not hold up the next)
  return mine;
}
