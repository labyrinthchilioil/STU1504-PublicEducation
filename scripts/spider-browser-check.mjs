// Companion integration checks via an existing Chromium CDP session.
// Serve the app on 4173 and launch Chromium with remote debugging on 9224.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.APP_BASE_URL || 'http://127.0.0.1:4173';
const debug = `http://127.0.0.1:${process.env.EDGE_DEBUG_PORT || 9224}`;
const page = await (await fetch(`${debug}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map(), checks = [], runtimeErrors = [];
let originalTheme;
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (request) {
      clearTimeout(request.timeout);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    }
  }
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
async function until(expression, description, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await evaluate(expression)) return;
    await pause(70);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function query(value) {
  await evaluate(`(()=>{
    const input=document.getElementById('spider-input');
    input.value=${JSON.stringify(value)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('spider-form').requestSubmit();
  })()`);
}
async function openResults() {
  await until(`!document.getElementById('spider-results-toggle').hidden`, 'the matching notes toggle');
  await click('spider-results-toggle');
  await until(`document.getElementById('spider-results-toggle').getAttribute('aria-expanded')==='true'&&!document.getElementById('spider-results').hidden`, 'expanded matching notes');
}
async function screenshot(name, selector) {
  await evaluate('document.fonts.ready');
  const clip = selector ? await evaluate(`(()=>{
    const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const width=Math.min(innerWidth,Math.max(420,r.width+200)),height=Math.min(innerHeight,Math.max(300,r.height+200));
    return {x:Math.max(0,Math.min(innerWidth-width,r.x+r.width/2-width/2)),y:Math.max(0,Math.min(innerHeight-height,r.y+r.height/2-height/2)),width,height,scale:2};
  })()`) : undefined;
  const image = await cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  await writeFile(`.preview/frosted-restored-spider-${name}.png`, Buffer.from(image.data, 'base64'));
}
async function selectionState(view) {
  const container = view === 'landscape' ? '#landscape-diagram' : '#diagram';
  const kind = view === 'landscape' ? '.landscape-node' : '.graph-node';
  const queryText = view === 'landscape' ? '.landscape-node-label' : '.graph-rich-text';
  return evaluate(`(()=>{
    const root=document.querySelector(${JSON.stringify(container)}),kind=${JSON.stringify(kind)};
    const matches=[...root.querySelectorAll(kind+'.is-spider-match')];
    const selected=[...root.querySelectorAll(kind+'.is-selected')];
    const registration=root.querySelector('.node-aura.is-selected .node-folder-elevation');
    const context=document.createElement('canvas').getContext('2d'),normalize=value=>{context.fillStyle=value;return context.fillStyle};
    return {
      matches:matches.length,
      selected:selected.length,
      matchedSelected:matches.filter(n=>n.classList.contains('is-selected')).length,
      selectedAuras:root.querySelectorAll('.node-aura.is-selected').length,
      queryAurasIndependent:matches.every(n=>{
        const aura=root.querySelector('.node-aura[data-aura-id="'+n.dataset.id+'"]');
        const glow=aura?.querySelector('.node-folder-elevation'),style=glow&&getComputedStyle(glow);
        const shadows=[...glow?.querySelectorAll('.node-folder-shadow-cast,.node-folder-shadow-contact')||[]];
        const visible=!!style&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0
          &&shadows.length===2&&shadows.every(part=>{
            const paint=getComputedStyle(part);
            const neutral=getComputedStyle(aura).getPropertyValue('--folder-shadow-color').trim()||'#142233';
            return normalize(paint.fill)===normalize(neutral)&&paint.stroke==='none'&&paint.filter!=='none'&&Number(paint.opacity)>0;
          });
        const face=aura?.querySelector('.node-folder-face');
        return !!face&&aura.classList.contains('is-query-match')&&!aura.classList.contains('is-inverted')
          &&normalize(getComputedStyle(face).fill)===normalize(getComputedStyle(aura).getPropertyValue('--folder-edge'))
          &&getComputedStyle(face).stroke==='none'
          &&aura.classList.contains('is-selected')===n.classList.contains('is-selected')
          &&aura.classList.contains('is-elevated')&&glow?.dataset.elevationState==='query'&&visible
          &&style.animationName==='none'&&!aura.querySelector('[class*="node-ember"]')
          &&[...aura.querySelectorAll('.node-folder-diffusion,.node-folder-outline,.node-aura-grain')].every(part=>getComputedStyle(part).display==='none');
      }),
      selectionBlooms:root.querySelectorAll('.glow-node').length,
      primaryBlooms:root.querySelectorAll('.glow-node.is-primary').length,
      queryLightText:matches.every(n=>{
        const text=n.querySelector(${JSON.stringify(queryText)}),style=text&&getComputedStyle(text);
        const color=${JSON.stringify(view)}==='landscape'?style?.fill:style?.color;
        return !!color&&normalize(color)===normalize(getComputedStyle(n).getPropertyValue('--folder-ink'));
      }),
      queryGrowth:matches.every(n=>Number(n.dataset.emphasisScale)===(${JSON.stringify(view)}==='landscape'
        ?n.classList.contains('is-selected')?1.32:1.26:n.classList.contains('is-selected')?1.2:1.16)),
      selectedEmphasis:!!registration&&getComputedStyle(registration).display!=='none'&&Number(getComputedStyle(registration).opacity)>0,
      markedText:root.querySelectorAll('.spider-mark').length
    };
  })()`);
}
async function frostedDecoration(view) {
  const container = view === 'landscape' ? '#landscape-diagram' : '#diagram';
  const kind = view === 'landscape' ? '.landscape-node' : '.graph-node';
  const shape = view === 'landscape' ? '.landscape-node-circle' : '.node-shape';
  return evaluate(`(()=>{
    const root=document.querySelector(${JSON.stringify(container)}),kind=${JSON.stringify(kind)},shape=${JSON.stringify(shape)};
    const auras=[...root.querySelectorAll('.node-aura')];
    const aligned=auras.length===128&&auras.every(aura=>{
      const source=root.querySelector(kind+'[data-id="'+aura.dataset.auraId+'"] '+shape)?.getBoundingClientRect();
      const face=aura.querySelector('.node-aura-face'),box=face?.getBoundingClientRect();
      return !!source&&!!box&&face.localName==='path'&&aura.dataset.displayShape==='folder'
        &&box.width>0&&box.height>0&&!aura.querySelector('[class*="node-aura-band"]')
        &&Math.abs(box.x+box.width/2-source.x-source.width/2)<.1
        &&Math.abs(box.y+box.height/2-source.y-source.height/2)<.1
        &&[...aura.querySelectorAll('path')].every(n=>!/(?:NaN|Infinity|undefined)/.test(n.getAttribute('d')||''));
    });
    const definition=root.querySelector('[data-aura-definitions]');
    const staticGrain=!!definition?.querySelector('pattern')&&!definition.querySelector('feTurbulence,animate,animateTransform,set')
      &&auras.every(n=>{const grain=n.querySelector('.node-aura-grain');return grain&&grain.getAnimations().length===0});
    const softEdges=auras.every(n=>{
      const halo=n.querySelector('.node-folder-diffusion'),face=n.querySelector('.node-folder-face');
      const clipId=halo?.getAttribute('clip-path')?.match(/#([^)"']+)/)?.[1],clip=clipId&&document.getElementById(clipId);
      if(n.classList.contains('is-elevated'))return getComputedStyle(halo).display==='none'
        &&getComputedStyle(face).stroke==='none'&&getComputedStyle(face).filter==='none'
        &&n.querySelectorAll('.node-folder-elevation > path').length===2;
      return halo&&getComputedStyle(halo).filter!=='none'&&clip?.firstElementChild?.getAttribute('d')===face?.getAttribute('d');
    });
    const context=document.createElement('canvas').getContext('2d'),colors=[];
    const normalize=value=>{context.fillStyle=value;return context.fillStyle};
    const sectionColors=['land','grid','environment','operation'].every(section=>{
      const aura=auras.find(n=>n.dataset.section===section),active=aura?.classList.contains('is-elevated');
      const edge=aura?.querySelector(active?'.node-folder-face':'.node-folder-outline');
      if(!edge)return false;
      const expected=normalize(getComputedStyle(aura).getPropertyValue('--folder-edge'));
      colors.push(expected);
      return normalize(getComputedStyle(edge)[active?'fill':'stroke'])===expected;
    });
    return {aligned,staticGrain,softEdges,sectionColors:sectionColors&&new Set(colors).size===4,colors};
  })()`);
}
const geometry = `JSON.stringify({
  nodes:[...document.querySelectorAll('#diagram .graph-node')].map(n=>[n.dataset.id,n.dataset.layoutX,n.dataset.layoutY,n.dataset.folderVariant,n.querySelector('.node-shape').outerHTML]),
  edges:[...document.querySelectorAll('#diagram .edge-line')].map(n=>n.closest('[data-id]').dataset.id),
  savedLayout:localStorage.getItem('frame12-layout-v1')
})`;
const displayGeometry = `JSON.stringify({
  nodes:[...document.querySelectorAll('#diagram .graph-node')].map(n=>[n.dataset.id,n.getAttribute('transform')]),
  edges:[...document.querySelectorAll('#diagram .edge-line')].map(n=>[n.closest('[data-id]').dataset.id,n.getAttribute('d')])
})`;
const landscapePositions = `JSON.stringify([...document.querySelectorAll('.landscape-node')].map(n=>[n.dataset.id,n.getAttribute('transform')]))`;
const dockVisible = `(()=>{
  const dock=document.getElementById('spider-dock'),input=document.getElementById('spider-input'),r=input.getBoundingClientRect();
  const style=getComputedStyle(dock),target=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return !dock.hidden&&style.visibility!=='hidden'&&Number(style.opacity)>0&&r.width>50&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&target===input;
})()`;
async function settled() {
  let last = await evaluate(landscapePositions), stable = 0;
  for (let index = 0; index < 90; index++) {
    await pause(90);
    const current = await evaluate(landscapePositions);
    stable = current === last ? stable + 1 : 0;
    if (stable >= 3) return current;
    last = current;
  }
  throw new Error('Spider landscape did not settle');
}
async function appearancePreview() {
  const originalGeometry = await evaluate(geometry);
  await click('theme-paper');
  const explorePaper = await frostedDecoration('diagram');
  check('Explore uses aligned frosted faces and four source region colors', explorePaper.aligned && explorePaper.staticGrain && explorePaper.softEdges && explorePaper.sectionColors, explorePaper);
  await screenshot('appearance-overview-paper');
  await click('theme-night');
  await screenshot('appearance-overview-night');
  await click('theme-paper');
  await query('hearing');
  await until(`document.querySelectorAll('.graph-node.is-spider-match').length>0`, 'Explore visual-preview matches');
  const queryOnly = await selectionState('diagram');
  check('Explore query matches grow with solid regional fills and static shadows without selected-node marks', queryOnly.selectedAuras === 0 && queryOnly.selectionBlooms === 0 && queryOnly.queryAurasIndependent && queryOnly.queryLightText && queryOnly.queryGrowth, queryOnly);
  await screenshot('appearance-explore-query-paper');
  await click('theme-night');
  await screenshot('appearance-explore-query-night');
  await click('theme-paper');
  await openResults();
  await evaluate(`document.querySelector('#spider-results button').click()`);
  await until(`!document.getElementById('inspector').hidden`, 'Explore visual-preview selection');
  await pause(180);
  await screenshot('appearance-explore-selected-paper', '#diagram .graph-node.is-primary');
  await click('theme-night');
  await screenshot('appearance-explore-selected-night', '#diagram .graph-node.is-primary');
  const selected = await selectionState('diagram');
  check('Explore selection keeps the solid query fill and shadows while enlarging the match', selected.selectedAuras === 1 && selected.primaryBlooms === 1 && selected.queryAurasIndependent && selected.markedText > 0 && selected.queryLightText && selected.queryGrowth && selected.selectedEmphasis, selected);
  const exploreNight = await frostedDecoration('diagram');
  check('Explore night mode preserves frosted geometry and section colors', exploreNight.aligned && exploreNight.staticGrain && exploreNight.softEdges && exploreNight.sectionColors, exploreNight);
  await click('close-inspector');
  await click('spider-clear');
  await click('theme-paper');
  await click('landscape-button');
  await until(`!document.getElementById('landscape-panel').hidden&&document.querySelectorAll('.landscape-node').length===128`, 'Discover visual preview');
  await settled();
  const discoverPaper = await frostedDecoration('landscape');
  check('Discover frosted nodes preserve source region colors with static grain', discoverPaper.aligned && discoverPaper.staticGrain && discoverPaper.softEdges && discoverPaper.sectionColors, discoverPaper);
  await screenshot('appearance-discover-idle-paper');
  await click('theme-night');
  await screenshot('appearance-discover-idle-night');
  await click('theme-paper');
  await query('hearing');
  await until(`document.querySelectorAll('.landscape-node.is-spider-match').length>0`, 'Discover visual-preview matches');
  await settled();
  const discoverQuery = await selectionState('landscape');
  check('Discover woven matches grow with solid regional fills and shadows without selected-node marks', discoverQuery.selectedAuras === 0 && discoverQuery.queryAurasIndependent && discoverQuery.queryLightText && discoverQuery.queryGrowth, discoverQuery);
  await screenshot('appearance-discover-query-paper');
  await click('theme-night');
  await screenshot('appearance-discover-query-night');
  await click('theme-paper');
  await evaluate(`document.querySelector('.landscape-node.is-spider-match').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(`!document.getElementById('inspector').hidden`, 'Discover visual-preview selection');
  await screenshot('appearance-discover-selected-paper', '#landscape-diagram .landscape-node.is-selected');
  await click('theme-night');
  await screenshot('appearance-discover-selected-night', '#landscape-diagram .landscape-node.is-selected');
  const discoverSelected = await selectionState('landscape');
  check('Discover selection keeps the solid woven query fill and shadows while adding growth', discoverSelected.selectedAuras === 1 && discoverSelected.matchedSelected === 1 && discoverSelected.queryAurasIndependent && discoverSelected.queryLightText && discoverSelected.queryGrowth && discoverSelected.selectedEmphasis, discoverSelected);
  const discoverNight = await frostedDecoration('landscape');
  check('Discover night mode preserves frosted geometry and section colors', discoverNight.aligned && discoverNight.staticGrain && discoverNight.softEdges && discoverNight.sectionColors, discoverNight);
  await click('close-inspector');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settled();
  check('The mobile Discover query stays usable without overflow', await evaluate(dockVisible) && await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  await screenshot('appearance-mobile-discover-night');
  await click('theme-paper');
  await screenshot('appearance-mobile-discover-paper');
  await evaluate(`document.querySelector('[data-region="all"]').click()`);
  await until(`document.getElementById('landscape-panel').hidden`, 'mobile Explore preview');
  await pause(180);
  check('The mobile Explore query stays usable without overflow', await evaluate(dockVisible) && await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  await screenshot('appearance-mobile-explore-paper');
  await click('theme-night');
  await screenshot('appearance-mobile-explore-night');
  check('Frosted styling leaves source geometry intact', originalGeometry === await evaluate(geometry));
  check('No browser runtime exceptions', runtimeErrors.length === 0, runtimeErrors);
  const failures = checks.filter(item => !item.passed);
  const report = { status: failures.length ? 'failed' : 'passed', checks, runtimeErrors };
  await writeFile('.preview/appearance-browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(failures, [], 'Frosted appearance checks failed');
}
await mkdir('.preview', { recursive: true });
try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.bringToFront');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await until(`document.querySelectorAll('.graph-node').length===128&&document.getElementById('loading-state').hidden&&document.querySelector('#spider-pet svg')`, 'the graph and spider companion');
  originalTheme = await evaluate(`localStorage.getItem('frame12-theme')`);
  if (process.env.SPIDER_SCENARIO === 'appearance') {
    await appearancePreview();
  } else {
  await click('theme-paper');
  const originalGeometry = await evaluate(geometry);
  const originalDisplayGeometry = await evaluate(displayGeometry);
  const originalText = await evaluate(`document.getElementById('diagram').textContent`);
  const explorePaper = await frostedDecoration('diagram');
  check('Explore frosted faces preserve source geometry and region colors with static grain', explorePaper.aligned && explorePaper.staticGrain && explorePaper.softEdges && explorePaper.sectionColors, explorePaper);
  check('Explore has a visible, pointer-accessible floating input', await evaluate(dockVisible));
  check('The compact input sits at the lower-left of the central canvas', await evaluate(`(()=>{
    const dock=document.getElementById('spider-dock').getBoundingClientRect(),main=document.getElementById('main').getBoundingClientRect();
    return dock.left>=main.left&&dock.left-main.left<=32&&dock.width<=390&&dock.bottom>main.top+main.height*.7;
  })()`));
  check('The companion interface presents English-only guidance', await evaluate(`(()=>{
    const dock=document.getElementById('spider-dock');
    return !/[\\u3400-\\u9fff]/.test(dock.textContent+' '+document.getElementById('spider-input').placeholder);
  })()`));
  check('The decorative pet has eight articulated legs', await evaluate(`document.querySelectorAll('#spider-pet .spider-leg').length===8&&document.getElementById('spider-pet').getAttribute('aria-hidden')==='true'`));
  const inlineHighlights = await evaluate(`(async()=>{
    const {highlightSpiderText,clearSpiderHighlights}=await import('./spider-highlights.js');
    const fixture=document.createElement('div');
    fixture.innerHTML='public <strong>hearing</strong> and water <em>supply</em> <a href="#source">evidence</a>';
    const text=fixture.textContent,link=fixture.querySelector('a'),strong=fixture.querySelector('strong');
    highlightSpiderText(fixture,['public hearing','water supply']);
    const marked=[...fixture.querySelectorAll('.spider-mark')].map(mark=>mark.textContent).join('|');
    const wrapped=fixture.querySelectorAll('.spider-mark').length===4&&marked==='public |hearing|water |supply'&&fixture.textContent===text&&fixture.querySelector('a')===link;
    clearSpiderHighlights(fixture);
    return {wrapped,restored:fixture.textContent===text&&fixture.querySelector('a')===link&&fixture.querySelector('strong')===strong&&fixture.querySelectorAll('.spider-mark').length===0};
  })()`);
  check('Phrase highlights span inline formatting and preserve source links and text on clear', inlineHighlights.wrapped && inlineHighlights.restored, inlineHighlights);
  await screenshot('explore-idle');

  await query('public hearing');
  await until(`document.querySelectorAll('.graph-node.is-spider-match').length>0`, 'Explore hearing matches');
  const explore = await evaluate(`({
    matches:document.querySelectorAll('.graph-node.is-spider-match').length,
    marks:document.querySelectorAll('#diagram .spider-mark').length,
    results:document.querySelectorAll('#spider-results button').length,
    status:document.getElementById('spider-status').textContent,
    visibleElevation:[...document.querySelectorAll('#diagram .node-aura.is-query-match .node-folder-elevation')].some(n=>getComputedStyle(n).display!=='none'&&Number(getComputedStyle(n).opacity)>0)
  })`);
  check('A natural-language query highlights a subset of source nodes and matching words', explore.matches > 0 && explore.matches < 128 && explore.marks > 0, explore);
  check('Highlighted nodes have visible elevation shadows and accessible result buttons', explore.visibleElevation && explore.results > 0);
  const queryOnly = await selectionState('diagram');
  check('Explore query matches grow with solid regional fills and shadows without selected-node emphasis', queryOnly.selected === 0 && queryOnly.selectedAuras === 0 && queryOnly.selectionBlooms === 0 && queryOnly.queryAurasIndependent && queryOnly.queryLightText && queryOnly.queryGrowth, queryOnly);
  check('Search preserves base positions and saved layout while enlarging and rerouting the display', originalGeometry === await evaluate(geometry) && originalDisplayGeometry !== await evaluate(displayGeometry));
  check('Matching source notes stay collapsed until requested', await evaluate(`document.getElementById('spider-results').hidden&&document.getElementById('spider-results-toggle').getAttribute('aria-expanded')==='false'`));
  await screenshot('explore-hearing');
  await openResults();
  check('Matching source notes can be opened explicitly', await evaluate(`!document.getElementById('spider-results').hidden`));
  await screenshot('explore-notes');
  await evaluate(`document.querySelector('#spider-results button').click()`);
  await until(`!document.getElementById('inspector').hidden`, 'a matched node inspector');
  check('A search result opens source details while keeping the input accessible', await evaluate(dockVisible));
  check('Opening source details collapses the notes popover', await evaluate(`document.getElementById('spider-results').hidden`));
  check('Source details retain text highlights', await evaluate(`document.querySelectorAll('#inspector-content .spider-mark').length>0`));
  const selectedQuery = await selectionState('diagram');
  check('Selecting a query result keeps its solid regional fill and shadows while adding growth', selectedQuery.matchedSelected === 1 && selectedQuery.selectedAuras === 1 && selectedQuery.primaryBlooms === 1 && selectedQuery.queryAurasIndependent && selectedQuery.markedText > 0 && selectedQuery.queryLightText && selectedQuery.queryGrowth && selectedQuery.selectedEmphasis, selectedQuery);
  await screenshot('appearance-explore-selected-paper', '#diagram .graph-node.is-primary');
  await click('theme-night');
  const exploreNight = await frostedDecoration('diagram');
  check('Explore night mode retains frosted shapes and region colors', exploreNight.aligned && exploreNight.staticGrain && exploreNight.softEdges && exploreNight.sectionColors, exploreNight);
  await screenshot('appearance-explore-selected-night', '#diagram .graph-node.is-primary');
  await click('theme-paper');
  await screenshot('explore-details');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await pause(180);
  check('The compact input stays usable beside the inspector at tablet desktop widths', await evaluate(dockVisible));
  check('The compact input and zoom controls do not overlap beside the inspector', await evaluate(`(()=>{
    const input=document.getElementById('spider-form').getBoundingClientRect(),controls=document.querySelector('.map-controls').getBoundingClientRect();
    return input.right<=controls.left||input.left>=controls.right||input.bottom<=controls.top||input.top>=controls.bottom;
  })()`));
  await screenshot('compact-desktop-details');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await pause(180);
  await click('close-inspector');
  const unselectedQuery = await selectionState('diagram');
  check('Closing Explore details retains solid query styling and highlighted text without selection emphasis', unselectedQuery.matches === queryOnly.matches && unselectedQuery.selected === 0 && unselectedQuery.selectedAuras === 0 && unselectedQuery.selectionBlooms === 0 && unselectedQuery.queryAurasIndependent && unselectedQuery.queryLightText && unselectedQuery.queryGrowth && unselectedQuery.markedText > 0, unselectedQuery);
  await click('spider-clear');
  await until(`document.querySelectorAll('.graph-node.is-spider-match').length===0`, 'cleared Explore highlights');
  check('Clearing search restores the exact initial display transforms and connector routes', originalDisplayGeometry === await evaluate(displayGeometry));
  check('Clear removes highlights and restores source text without mutation', await evaluate(`document.querySelectorAll('#diagram .spider-mark').length===0&&document.getElementById('spider-input').value===''&&document.getElementById('diagram').textContent===${JSON.stringify(originalText)}`));
  await evaluate(`(()=>{
    const input=document.getElementById('spider-input');
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    input.value='公众';
    input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'公众'}));
  })()`);
  await pause(650);
  check('IME composition does not search unfinished Chinese text', await evaluate(`document.querySelectorAll('.graph-node.is-spider-match').length===0&&document.getElementById('spider-dock').dataset.spiderState==='idle'`));
  await evaluate(`(()=>{
    const input=document.getElementById('spider-input');
    input.value='公众参与';
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'公众参与'}));
  })()`);
  await until(`document.querySelectorAll('.graph-node.is-spider-match').length>0`, 'committed Chinese composition');
  check('Completing IME composition searches the complete phrase', await evaluate(`document.querySelectorAll('.graph-node.is-spider-match').length>0`));
  await click('spider-clear');

  await click('landscape-button');
  await until(`document.querySelectorAll('.landscape-node').length===128&&!document.getElementById('landscape-panel').hidden`, 'Discover');
  const scatter = await settled();
  const scatterCamera = await evaluate(`document.querySelector('.landscape-viewport').getAttribute('transform')`);
  check('Discover shares the same visible input and pet', await evaluate(dockVisible));
  const discoverPaper = await frostedDecoration('landscape');
  check('Discover uses aligned frosted nodes with source colors and static grain', discoverPaper.aligned && discoverPaper.staticGrain && discoverPaper.softEdges && discoverPaper.sectionColors, discoverPaper);
  check('Discover nodes retain separate usable transparent hit targets', await evaluate(`(()=>{
    return [...document.querySelectorAll('.landscape-node')].every(node=>{
      const hit=node.querySelector('.landscape-node-hit'),pin=node.querySelector('.landscape-node-circle');
      if(!hit||!pin)return false;
      const h=hit.getBoundingClientRect(),p=pin.getBoundingClientRect();
      return hit.localName==='path'&&pin.localName==='path'
        &&h.width>=17.9&&h.height>=17.9&&h.width>=p.width&&h.height>=p.height
        &&getComputedStyle(hit).pointerEvents!=='none';
    });
  })()`));
  await screenshot('discover-idle');
  await query('hearing');
  await until(`document.querySelectorAll('.landscape-node.is-spider-match').length>0&&document.querySelectorAll('.silk-spoke').length>0`, 'spider silk and matched Discover nodes');
  const woven = await settled();
  const discover = await evaluate(`({
    matches:document.querySelectorAll('.landscape-node.is-spider-match').length,
    spokes:document.querySelectorAll('.silk-spoke').length,
    rings:document.querySelectorAll('.silk-ring').length,
    nodes:document.querySelectorAll('.landscape-node').length,
    sourceEdges:document.querySelectorAll('.landscape-edge[data-kind="source"]').length,
    finite:[...document.querySelectorAll('.landscape-node')].every(n=>{const m=n.transform.baseVal.consolidate()?.matrix;return m&&Number.isFinite(m.e)&&Number.isFinite(m.f)}),
    silkFinite:[...document.querySelectorAll('.landscape-silk path')].every(n=>!/(?:NaN|Infinity|undefined)/.test(n.getAttribute('d')||'')),
    hub:!!document.querySelector('.landscape-web-hub'),
    tether:(()=>{
      const svg=document.getElementById('spider-tether'),line=svg.querySelector('.spider-tether-line'),r=svg.getBoundingClientRect();
      return !!line?.getAttribute('d')&&getComputedStyle(svg).display!=='none'&&getComputedStyle(svg).visibility!=='hidden'&&r.width>0&&r.height>0;
    })()
  })`);
  check('Discover gathers matched nodes into a connected spider web', scatter !== woven && discover.spokes > 0 && discover.rings > 0 && discover.hub, discover);
  check('Web gathering retains all source nodes and directed connections', discover.nodes === 128 && discover.sourceEdges === 181);
  check('All gathered node and silk coordinates are finite', discover.finite && discover.silkFinite);
  check('The floating spider is tethered to its web', discover.tether);
  check('The zoom readout follows the gathered web camera', await evaluate(`document.getElementById('zoom-level').value===Math.round(document.querySelector('.landscape-viewport').transform.baseVal.consolidate().matrix.a*100)+'%'`));
  const discoverQuery = await selectionState('landscape');
  check('Discover query matches grow with solid regional fills and shadows without acquiring selected-node marks', discoverQuery.selected === 0 && discoverQuery.selectedAuras === 0 && discoverQuery.queryAurasIndependent && discoverQuery.queryLightText && discoverQuery.queryGrowth, discoverQuery);
  await screenshot('discover-hearing');
  await evaluate(`document.querySelector('.landscape-node.is-spider-match').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(`!document.getElementById('inspector').hidden`, 'a selected Discover search match');
  const discoverSelected = await selectionState('landscape');
  check('Selecting a woven node keeps its solid regional fill and shadows while adding growth', discoverSelected.matchedSelected === 1 && discoverSelected.selectedAuras === 1 && discoverSelected.queryAurasIndependent && discoverSelected.queryLightText && discoverSelected.queryGrowth && discoverSelected.selectedEmphasis, discoverSelected);
  await screenshot('appearance-discover-selected-paper', '#landscape-diagram .landscape-node.is-selected');
  await click('theme-night');
  check('Dark appearance preserves a usable spider input', await evaluate(dockVisible));
  const discoverNight = await frostedDecoration('landscape');
  check('Discover night mode keeps source colors and static frosted texture', discoverNight.aligned && discoverNight.staticGrain && discoverNight.softEdges && discoverNight.sectionColors, discoverNight);
  await screenshot('appearance-discover-selected-night', '#landscape-diagram .landscape-node.is-selected');
  await click('close-inspector');
  const discoverUnselected = await selectionState('landscape');
  check('Closing Discover details keeps woven query fills and shadows while removing selection emphasis', discoverUnselected.matches === discoverQuery.matches && discoverUnselected.selected === 0 && discoverUnselected.selectedAuras === 0 && discoverUnselected.queryAurasIndependent && discoverUnselected.queryLightText && discoverUnselected.queryGrowth, discoverUnselected);
  await screenshot('discover-night');

  await query('electric grid');
  await until(`document.getElementById('spider-input').value==='electric grid'&&document.querySelectorAll('.landscape-node.is-spider-match').length>0`, 'replacement search');
  const replaced = await settled();
  check('Changing the query reorganizes the gathered web', replaced !== woven);
  await query('zzzxylophonenoresult');
  await until(`document.getElementById('spider-dock').dataset.spiderState==='empty'`, 'the empty search state');
  check('An unmatched query has no invented matches and gives feedback', await evaluate(`document.querySelectorAll('.landscape-node.is-spider-match').length===0&&document.getElementById('spider-status').textContent.length>0&&document.querySelectorAll('#spider-results button').length===0`));
  await screenshot('empty');
  await query('公众参与');
  await until(`document.querySelectorAll('.landscape-node.is-spider-match').length>0`, 'Chinese topic matches');
  check('Chinese public-participation concepts find existing source nodes', await evaluate(`document.querySelectorAll('.landscape-node.is-spider-match').length>0`));
  await settled();
  await click('spider-clear');
  await settled();
  check('Clear releases the web and resets the query', await evaluate(`document.getElementById('spider-input').value===''&&document.querySelectorAll('.landscape-node.is-spider-match').length===0&&!document.getElementById('landscape-diagram').classList.contains('has-spider-web')`));
  check('Clear restores the exact original node positions and camera', scatter === await evaluate(landscapePositions) && scatterCamera === await evaluate(`document.querySelector('.landscape-viewport').getAttribute('transform')`));

  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(150);
  await query('hearing');
  await until(`document.querySelectorAll('.landscape-node.is-spider-match').length>0`, 'mobile matches');
  await settled();
  check('The mobile input is visible without horizontal page overflow', await evaluate(dockVisible) && await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  await screenshot('mobile-discover');
  await openResults();
  await evaluate(`document.querySelector('#spider-results button').click()`);
  await until(`!document.getElementById('inspector').hidden`, 'mobile inspector');
  check('The mobile inspector does not cover the floating input', await evaluate(dockVisible));
  await screenshot('mobile-details');
  await click('close-inspector');
  await evaluate(`document.querySelector('[data-region="all"]').click()`);
  await until(`document.getElementById('landscape-panel').hidden`, 'mobile Explore');
  check('The shared query survives Discover to Explore navigation', await evaluate(`document.getElementById('spider-input').value==='hearing'&&document.querySelectorAll('.graph-node.is-spider-match').length>0`));
  check('The mobile Explore input is visible and usable', await evaluate(dockVisible));
  await screenshot('mobile-explore');

  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click('landscape-button');
  await query('environment');
  await until(`document.querySelectorAll('.landscape-node.is-spider-match').length>0`, 'reduced-motion matches');
  const reducedBefore = await settled();
  await pause(350);
  check('Reduced motion settles the web without continuing pet animation', reducedBefore === await evaluate(landscapePositions) && await evaluate(`document.querySelector('#spider-pet .spider-creature').getAnimations().filter(a=>a.playState==='running').length===0`));
  await screenshot('reduced-motion');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  await click('landscape-overview');
  await until(`document.getElementById('main').classList.contains('is-untangling')`, 'untangle transition');
  check('Untangling hides the dock and its decorative tether', await evaluate(`getComputedStyle(document.getElementById('spider-dock')).visibility==='hidden'&&getComputedStyle(document.getElementById('spider-tether')).visibility==='hidden'`));
  await until(`!document.getElementById('main').classList.contains('is-untangling')&&document.getElementById('landscape-panel').hidden`, 'completed Overview transition');
  await until(dockVisible, 'the dock fading back in after untangling');
  check('The input returns after the transition and source geometry is preserved', await evaluate(dockVisible) && originalGeometry === await evaluate(geometry));
  await query('hearing');
  await until(`document.querySelectorAll('.graph-node.is-spider-match').length>0`, 'repeat search after untangling');
  check('The spider remains usable after the Discover animation', await evaluate(`document.querySelectorAll('#spider-results button').length>0`));
  await click('spider-clear');
  check('No browser runtime exceptions', runtimeErrors.length === 0, runtimeErrors);
  const failures = checks.filter(item => !item.passed);
  const report = { status: failures.length ? 'failed' : 'passed', checks, runtimeErrors };
  await writeFile('.preview/spider-browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(failures, [], 'Spider integration checks failed');
  }
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile('.preview/spider-browser-report.json', JSON.stringify({ status: 'failed', checks, runtimeErrors, error: error.stack || String(error) }, null, 2));
  throw error;
} finally {
  if (originalTheme !== undefined) await evaluate(`(()=>{
    const theme=${JSON.stringify(originalTheme)};
    if(theme===null)localStorage.removeItem('frame12-theme');else localStorage.setItem('frame12-theme',theme);
  })()`).catch(() => {});
  socket.close();
  await fetch(`${debug}/json/close/${page.id}`).catch(() => {});
}
