// Boot: the header, the views, the keys and the address. Every view reads NX.state and redraws when
// it changes; only the visible view draws, the others catch up when they are shown.
(function () {
  'use strict';
  const NX = window.NX, { $ } = NX;
  const ui = NX.ui;
  const VIEW = { walk: NX.walk, map: NX.map, seq: NX.seq, trace: NX.trace, data: NX.data };
  const dirty = new Set(Object.keys(VIEW));

  function showView() {
    for (const v of NX.VIEWS) $('#v-' + v.id).hidden = v.id !== NX.state.view;
    document.body.dataset.view = NX.state.view;
    ui.syncHeader();
    NX.walk.syncPill();
  }
  function draw(changed) {
    const v = NX.state.view;
    const view = VIEW[v];
    if (!view) return;
    if (dirty.has(v)) { dirty.delete(v); view.render({ ...changed, all: true }); }
    else view.render(changed);
  }
  NX.on((changed) => {
    if (changed.view) showView();
    if (changed.flow) ui.syncHeader();
    if (changed.node) ui.renderNodeCard();
    const big = changed.stack || changed.flow || changed.open || changed.theme || changed.sources || changed.line;
    if (big) for (const k of Object.keys(VIEW)) if (k !== NX.state.view) dirty.add(k);
    if (changed.theme) dirty.add(NX.state.view);
    if (changed.view || big) draw(changed);
    else if (changed.node) { const v = VIEW[NX.state.view]; if (v && v.onNode) v.onNode(); }
  });

  // ---------------------------------------------------------------- header and shared clicks
  document.addEventListener('click', (e) => {
    const t = e.target;
    const flow = t.closest('#flows [data-flow]');
    if (flow) { NX.walk.stopPlay(); NX.setFlow(flow.dataset.flow); return; }
    const view = t.closest('#views [data-view]');
    if (view) { NX.set({ view: view.dataset.view }, { push: true }); return; }
    if (t.closest('#themeBtn')) { ui.cycleTheme(); return; }
    if (t.closest('#ppStop')) { NX.walk.stopPlay(); return; }
    if (t.closest('#ppGo')) { NX.set({ view: 'walk' }, { push: true }); return; }
    if (t.closest('#helpBtn')) { ui.openHelp(); return; }
    if (t.closest('[data-help-close]') || t.id === 'help') { ui.closeHelp(); return; }
    if (t.closest('[data-nc-close]') || t.id === 'scrim') { ui.closeNode(); return; }
    // inside the node card
    const stepBtn = t.closest('#ncard [data-stack]');
    if (stepBtn && stepBtn.dataset.stack) {
      const st = NX.parseStack(stepBtn.dataset.stack);
      if (st) { NX.walk.stopPlay(); NX.set({ stack: st, node: matchMedia('(max-width: 760px)').matches ? null : NX.state.node }, { push: true }); }
      return;
    }
    const paper = t.closest('#ncard [data-paper]');
    if (paper) {
      const st = NX.paperEntry(paper.dataset.paper);
      if (st) { NX.walk.stopPlay(); NX.set({ stack: st, view: 'walk', node: null }, { push: true }); }
      return;
    }
    const codeBtn = t.closest('#ncard [data-code-node]');
    if (codeBtn) {
      const id = codeBtn.dataset.codeNode;
      NX.set({ view: 'walk', node: matchMedia('(max-width: 1100px)').matches ? null : NX.state.node }, { push: true });
      setTimeout(() => NX.walk.showNodeCode(id), 0);
      return;
    }
    // a node chip anywhere opens the node card
    const chip = t.closest('[data-node]');
    if (chip && !chip.closest('.sq-card') && !chip.closest('.mt-station')) { ui.hideTip(); ui.openNode(chip.dataset.node); return; }
    const card = t.closest('.sq-card[data-node]');
    if (card) { ui.openNode(card.dataset.node); }
  });

  // A button clicked with the mouse gives its focus back, so Enter and Space keep doing what the keys
  // say (a button reached with Tab keeps focus, and Enter or Space presses it).
  document.addEventListener('click', (e) => {
    if (!e.detail) return;
    const b = e.target.closest && e.target.closest('button, [role="button"], [role="tab"]');
    if (b && document.activeElement === b) b.blur();
  });

  // ---------------------------------------------------------------- keys
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (typing) return;
    if (!$('#help').hidden) { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); ui.closeHelp(); } return; }
    if (e.key === '/') { e.preventDefault(); ui.openSearch(); return; }
    if (e.key === '?') { e.preventDefault(); ui.openHelp(); return; }
    if (/^[1-5]$/.test(e.key)) { NX.set({ view: NX.VIEWS[Number(e.key) - 1].id }, { push: true }); return; }
    if (e.key === ' ' && !(e.target.closest && e.target.closest('button,a,[role="button"],[role="tab"]'))) {
      e.preventDefault();
      // Space stops a walk where it is; it starts one in 歩く
      if (NX.walk.playing()) { NX.walk.stopPlay(); return; }
      if (NX.state.view !== 'walk') NX.set({ view: 'walk' }, { push: true });
      NX.walk.togglePlay();
      return;
    }
    const view = VIEW[NX.state.view];
    if (e.key === 'Escape' && NX.state.node) {
      // the card closes first, unless the view has something nearer to close
      if (!(view.escFirst && view.escFirst())) { e.preventDefault(); ui.closeNode(); return; }
    }
    if (e.key === 'Enter' && e.target.closest && e.target.closest('button,a,[role="button"]')) {
      const row = e.target.closest('[data-go]');
      const here = `${NX.state.stack.length - 1}:${NX.topOf(NX.state.stack).i}`;
      if (!row || row.dataset.go !== here) return;
    }
    if (view && view.onKey && view.onKey(e)) return;
    if (NX.state.view !== 'walk' && ['ArrowRight', 'ArrowLeft', 'Enter', 'Escape', 'Home', 'End'].includes(e.key)) NX.walk.onKey(e);
  });

  // ---------------------------------------------------------------- the address
  window.addEventListener('popstate', () => { const c = NX.readHash(); if (c && Object.keys(c).length) { NX.walk.stopPlay(); NX.emit(c, { source: 'hash' }); } });
  window.addEventListener('hashchange', () => { const c = NX.readHash(); if (c && Object.keys(c).length) { NX.walk.stopPlay(); NX.emit(c, { source: 'hash' }); } });
  let rz = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      for (const k of Object.keys(VIEW)) dirty.add(k);
      const v = VIEW[NX.state.view];
      if (v.onResize) { dirty.delete(NX.state.view); v.onResize(); } else draw({ resize: true });
    }, 120);
  });

  // ---------------------------------------------------------------- start
  ui.init();
  const had = NX.readHash();
  if (had && had.stack) NX.state.touched = true; else NX.state.touched = false;
  NX.writeHash(false);
  showView();
  ui.renderNodeCard();
  draw({ all: true });
  // the sources come after the first paint
  requestAnimationFrame(() => setTimeout(() => NX.code.load(), 30));
  window.NEXT_READY = true;
})();
