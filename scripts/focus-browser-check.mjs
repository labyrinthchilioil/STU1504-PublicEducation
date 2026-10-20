// Verify section focus, inward folder diffusion and selection in Edge.
// Requires npm start and a dedicated DevTools endpoint (default port 9224).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:4173';
const debug = `http://127.0.0.1:${process.env.EDGE_DEBUG_PORT || 9224}`;
const page = await (await fetch(`${debug}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map(), errors = [], extensionErrors = [], checks = {}, details = {};
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    message.error ? task?.reject(new Error(message.error.message)) : task?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const exception = message.params.exceptionDetails;
    // Managed browser extensions can inject scripts into a clean test profile.
    // Preserve their diagnostics separately without treating them as app failures.
    (exception.url?.startsWith('chrome-extension://') ? extensionErrors : errors).push(exception);
  }
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() {
  for (let i = 0; i < 100; i++) {
    if (await evaluate('document.querySelectorAll(".graph-node").length === 128 && document.getElementById("loading-state").hidden')) {
      await evaluate('document.fonts.ready');
      return;
    }
    await delay(100);
  }
  throw new Error('Diagram did not load');
}
async function flushGraphStyles() {
  // Offscreen SVG transitions may start only when headless Edge commits styles.
  // Commit the changed state before measuring the existing transition window.
  await evaluate(`(()=>{for(const n of document.querySelectorAll('.graph-node,.graph-edge,.graph-note'))getComputedStyle(n).opacity;return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})()`);
}
async function click(id) {
  await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await flushGraphStyles();
  await delay(280);
}
async function region(key) {
  await evaluate(`document.querySelector('[data-region="${key}"]').click()`);
  await flushGraphStyles();
  await delay(280);
}
async function activate(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await flushGraphStyles();
  await delay(280);
}
function check(name, value) { checks[name] = !!value; }
async function screenshot(name) {
  const image = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(`.preview/frosted-restored-${name}.png`, Buffer.from(image.data, 'base64'));
}
async function sectionState(key) {
  return evaluate(`(() => {
    const key=${JSON.stringify(key)}, result={};
    for (const kind of ['node','edge','note']) {
      const groups=[...document.querySelectorAll('.graph-'+kind)];
      const local=groups.filter(n=>n.dataset.section===key), other=groups.filter(n=>n.dataset.section!==key);
      result[kind]={local:local.length,other:other.length,
        localClear:local.every(n=>!n.classList.contains('is-region-muted')&&Number(getComputedStyle(n).opacity)>=.99),
        otherMuted:other.every(n=>n.classList.contains('is-region-muted')&&Number(getComputedStyle(n).opacity)<=.22)};
    }
    result.active=document.querySelector('[data-region="'+key+'"]').getAttribute('aria-current')==='true'&&document.getElementById('diagram').dataset.activeRegion===key;
    return result;
  })()`);
}
async function noBlurredText() {
  return evaluate(`(() => {
    const selectors=['.graph-node .graph-rich-text','.edge-label','.graph-note .graph-rich-text'];
    return selectors.every(selector=>[...document.querySelectorAll(selector)].every(text=>{
      for(let node=text;node&&node.id!=='diagram';node=node.parentElement)if(getComputedStyle(node).filter!=='none')return false;
      return true;
    }));
  })()`);
}
async function glowState() {
  return evaluate(`(() => {
    const layer=document.querySelector('.graph-selection-glow');
    return {exists:!!layer,children:layer?.children.length||0,
      noPointer:!!layer&&getComputedStyle(layer).pointerEvents==='none',
      filters:layer?[...layer.querySelectorAll('[filter]')].map(n=>n.getAttribute('filter')):[],
      primaryNodes:layer?.querySelectorAll('.glow-node.is-primary').length||0,
      primaryEdges:layer?.querySelectorAll('.glow-edge.is-primary').length||0,
      markup:layer?.innerHTML||''};
  })()`);
}
async function glowTracksGeometry() {
  return evaluate(`(() => {
    const sameCenter=(a,b)=>Math.abs(a.x+a.width/2-b.x-b.width/2)<.1&&Math.abs(a.y+a.height/2-b.y-b.height/2)<.1;
    const tracks=(piece,source)=>sameCenter(piece.getBoundingClientRect(),source.getBoundingClientRect());
    return [...document.querySelectorAll('.glow-node')].every(glow=>tracks(glow.querySelector('.glow-bloom'),document.querySelector('.graph-node[data-id="'+glow.dataset.glowId+'"] .node-shape')))
      &&[...document.querySelectorAll('.node-aura')].every(aura=>['.node-aura-face','.node-aura-grain'].every(selector=>getComputedStyle(aura.querySelector(selector)).display==='none'||tracks(aura.querySelector(selector),document.querySelector('.graph-node[data-id="'+aura.dataset.auraId+'"] .node-shape'))))
      &&[...document.querySelectorAll('.glow-edge')].every(glow=>glow.querySelector('.glow-core').getAttribute('d')===document.querySelector('.graph-edge[data-id="'+glow.dataset.glowId+'"] .edge-line').getAttribute('d'));
  })()`);
}
async function primaryGlowCenter() {
  return evaluate(`(()=>{const b=document.querySelector('.glow-node.is-primary .glow-bloom').getBBox();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
}
async function auraStateMatchesNodes() {
  return evaluate(`(()=>{const auras=[...document.querySelectorAll('.graph-node-auras > .node-aura')];return auras.length===128&&auras.every(aura=>{const node=document.querySelector('.graph-node[data-id="'+aura.dataset.auraId+'"]');return node&&aura.dataset.section===node.dataset.section&&['is-region-muted','is-dimmed','is-selected'].every(name=>aura.classList.contains(name)===node.classList.contains(name))})})()`);
}
async function frostedFacesMatchSource() {
  return evaluate(`(async()=>{
    const source=await(await fetch('data/frame12.json')).json();
    const sameOutline=(face,hit)=>[0,.125,.25,.375,.5,.625,.75,.875,1].every(t=>{
      const a=face.getPointAtLength(face.getTotalLength()*t).matrixTransform(face.getScreenCTM());
      const b=hit.getPointAtLength(hit.getTotalLength()*t).matrixTransform(hit.getScreenCTM());
      return Math.hypot(a.x-b.x,a.y-b.y)<.1;
    });
    return source.nodes.length===128&&source.nodes.every(node=>{
      const aura=document.querySelector('.node-aura[data-aura-id="'+node.node_id+'"]');
      if(!aura||aura.dataset.sourceShape!==node.shape||aura.dataset.displayShape!=='folder')return false;
      const hit=document.querySelector('.graph-node[data-id="'+node.node_id+'"] .node-shape');
      return ['.node-aura-face','.node-aura-grain'].every(selector=>{
        const face=aura.querySelector(selector);
        if(!face||face.localName!==hit.localName)return false;
        return sameOutline(face,hit);
      })&&!aura.querySelector('[class*="node-aura-band"]');
    });
  })()`);
}
async function frostedRegionColors() {
  return evaluate(`(()=>{
    const context=document.createElement('canvas').getContext('2d'),colors=[];
    const normalize=value=>{context.fillStyle=value;return context.fillStyle};
    for(const section of ['land','grid','environment','operation']){
      const aura=document.querySelector('.node-aura[data-section="'+section+'"]');
      const edge=aura?.querySelector('.node-folder-diffusion'),face=aura?.querySelector('.node-folder-face');
      const clipId=edge?.getAttribute('clip-path')?.match(/#([^)"']+)/)?.[1],clip=clipId&&document.getElementById(clipId);
      if(!edge||!face||clip?.firstElementChild?.getAttribute('d')!==face.getAttribute('d'))return false;
      const expected=normalize(getComputedStyle(aura).getPropertyValue('--folder-edge'));
      if(normalize(getComputedStyle(aura.querySelector('.node-folder-outline')).stroke)!==expected||getComputedStyle(edge).filter==='none')return false;
      colors.push(expected);
    }
    return new Set(colors).size===4;
  })()`);
}
async function staticFrostedGrain() {
  return evaluate(`(()=>{
    const definition=document.querySelector('[data-aura-definitions]'),patterns=[...definition.querySelectorAll('pattern')];
    const grain=[...document.querySelectorAll('#diagram .node-aura-grain')];
    const valid=patterns.length>0&&grain.length===128&&!definition.querySelector('feTurbulence,animate,animateTransform,set')
      &&grain.every(n=>n.getAnimations().length===0);
    const before=patterns.map(n=>n.outerHTML).join('');
    return new Promise(resolve=>setTimeout(()=>resolve(valid&&before===patterns.map(n=>n.outerHTML).join('')),350));
  })()`);
}
async function sourceGeometryMatches() {
  return evaluate(`(async()=>{
    const source=await(await fetch('data/frame12.json')).json();
    const {folderPath}=await import('./folder-shape.js');
    return document.querySelectorAll('.graph-node').length===source.nodes.length&&source.nodes.every(node=>{
      const shape=document.querySelector('.graph-node[data-id="'+node.node_id+'"] .node-shape');
      if(!shape)return false;
      const box=node.layout,width=box.width*1.25,height=box.height*1.25;
      const x=box.x+(box.width-width)/2,y=box.y+(box.height-height)/2;
      return shape.localName==='path'&&shape.closest('.graph-node').dataset.folderVariant===node.shape
        &&shape.getAttribute('d')===folderPath({x,y,width,height},node.shape);
    });
  })()`);
}
async function frostBoundsCheck() {
  const neutral = await evaluate(`(()=>{
    const context=document.createElement('canvas').getContext('2d'),normalize=value=>{context.fillStyle=value;return context.fillStyle};
    const auras=[...document.querySelectorAll('#diagram .node-aura')].filter(n=>!['land','grid','environment','operation'].includes(n.dataset.section));
    const results=auras.map(aura=>{
      const edge=aura.querySelector('.node-folder-diffusion');
      const expected=normalize(getComputedStyle(aura).getPropertyValue('--folder-edge'));
      const accent=normalize(getComputedStyle(aura).getPropertyValue('--accent'));
      const actual=edge&&normalize(getComputedStyle(edge).stroke);
      return {id:aura.dataset.auraId,expected,accent,actual,valid:actual===expected&&expected!==accent};
    });
    return {count:results.length,valid:results.length>0&&results.every(n=>n.valid),sample:results[0]};
  })()`);
  details.neutral = neutral;
  check('Unassigned folders use their fallback edge color rather than a region or accent color', neutral.valid);
  const routes = await evaluate(`(()=>{
    const edges=[...document.querySelectorAll('.graph-edge')].map(edge=>({id:edge.dataset.id,box:edge.querySelector('.edge-line').getBBox()}));
    return {vertical:edges.find(e=>e.box.width<.001&&e.box.height>1)?.id,horizontal:edges.find(e=>e.box.height<.001&&e.box.width>1)?.id};
  })()`);
  for (const direction of ['vertical', 'horizontal']) {
    assert(routes[direction], `No existing ${direction} route to verify`);
    await activate(`.graph-edge[data-id="${routes[direction]}"]`);
    const bounds = await evaluate(`(()=>{
      const glow=document.querySelector('.glow-edge.is-primary .glow-bloom'),id=glow.getAttribute('filter').match(/#([^)"']+)/)[1];
      const filter=document.getElementById(id),box=glow.getBBox(),blur=filter.querySelector('feGaussianBlur');
      const values=['x','y','width','height'].map(name=>Number(filter.getAttribute(name)));
      const [x,y,width,height]=values;
      const source=document.querySelector('.graph-edge[data-id="'+glow.closest('.glow-edge').dataset.glowId+'"] .edge-line');
      return {box:{x:box.x,y:box.y,width:box.width,height:box.height},filter:{x,y,width,height},
        userSpace:filter.getAttribute('filterUnits')==='userSpaceOnUse'&&filter.getAttribute('primitiveUnits')==='userSpaceOnUse',
        finite:values.every(Number.isFinite)&&width>0&&height>0&&Number(blur.getAttribute('stdDeviation'))>0,
        padded:x<box.x&&y<box.y&&x+width>box.x+box.width&&y+height>box.y+box.height,
        sourceRoute:glow.getAttribute('d')===source.getAttribute('d')};
    })()`);
    details[direction] = bounds;
    check(`${direction} selected route has finite positive blur bounds covering the full path and padding`, bounds.userSpace && bounds.finite && bounds.padded && bounds.sourceRoute);
    await click('close-inspector');
  }
  await region('land');
  await activate('.graph-node[data-id="3458764686135623224"]');
  await screenshot('reference-rect-diamond-paper');
  check('Final focused frost checks retain enlarged cards around source centers', await sourceGeometryMatches());
  check('Final focused frost checks have no browser runtime errors', errors.length === 0);
  const report = { status: Object.values(checks).every(Boolean) ? 'passed' : 'failed', checks, details, runtimeErrors: errors };
  await writeFile('.preview/frosted-restored-bounds-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert(Object.values(checks).every(Boolean), 'Focused frost bounds checks failed');
}

let originalStorage;
try {
  await mkdir('.preview', { recursive: true });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.bringToFront');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base }); await ready();
  originalStorage = await evaluate('({layout:localStorage.getItem("frame12-layout-v1"),theme:localStorage.getItem("frame12-theme")})');
  await evaluate('localStorage.removeItem("frame12-layout-v1");location.hash=""');
  await cdp('Page.reload'); await ready();
  await click('theme-paper');
  if (process.env.FOCUS_SCENARIO === 'frost-bounds') {
    await frostBoundsCheck();
  } else {
  check('Every node has a non-interactive frosted face before any selection', await auraStateMatchesNodes() && await evaluate(`(()=>{const layer=document.querySelector('.graph-node-auras');return getComputedStyle(layer).pointerEvents==='none'&&document.querySelectorAll('.graph-node.is-selected').length===0&&[...layer.children].every(n=>getComputedStyle(n).display!=='none'&&Number(getComputedStyle(n).opacity)>0)})()`));
  check('Fine grain is shared and remains static without animated noise', await staticFrostedGrain());
  check('Original node IDs retain centered 25% enlargement with exact squared-folder and rounded-diamond silhouettes', await sourceGeometryMatches());
  check('All 128 node faces and grain layers align with hit paths and retain original shape metadata', await frostedFacesMatchSource());
  check('Folder edge colors stay distinct and their diffusion is clipped inside the silhouette', await frostedRegionColors());
  check('Folder hit paths remain transparent before interaction', await evaluate(`[...document.querySelectorAll('.node-shape,.node-outline')].every(n=>{const s=getComputedStyle(n),clear=Number(s.opacity)===0;return clear||((Number(s.fillOpacity)===0||s.fill==='none'||s.fill==='rgba(0, 0, 0, 0)')&&(Number(s.strokeOpacity)===0||s.stroke==='none'||s.stroke==='rgba(0, 0, 0, 0)'))})`));
  await screenshot('auras-overview-paper');

  for (const key of ['land', 'grid', 'environment', 'operation']) {
    await region(key);
    const state = await sectionState(key); details[key] = state;
    check(`${key}: active section is identified in navigation`, state.active);
    for (const kind of ['node', 'edge', 'note']) {
      check(`${key}: only this section's ${kind}s remain at full opacity`, state[kind].localClear && state[kind].otherMuted);
    }
    check(`${key}: node auras mirror regional focus`, await auraStateMatchesNodes());
  }
  await region('land'); await screenshot('focus-land-paper');
  const identitiesBefore = await evaluate(`JSON.stringify([...document.querySelectorAll('.graph-node,.graph-edge,.graph-note')].map(n=>[n.dataset.id,n.dataset.section]))`);
  await region('all');
  check('Overview removes regional fading from every node, connector and source note', await evaluate(`document.getElementById('diagram').dataset.activeRegion==='all'&&document.querySelectorAll('.is-region-muted').length===0&&[...document.querySelectorAll('.graph-node,.graph-edge,.graph-note')].every(n=>Number(getComputedStyle(n).opacity)>=.99)`));

  await region('land');
  const landNode = '.graph-node[data-id="3458764686135623224"]';
  await activate(landNode);
  const selectedGlow = await glowState(); details.nodeGlow = { ...selectedGlow, markup: undefined };
  check('Selecting a node keeps its selection layer non-interactive without painting a colored border', selectedGlow.exists && selectedGlow.primaryNodes === 1 && selectedGlow.noPointer && await evaluate(`(()=>{const n=document.querySelector('.glow-node.is-primary .glow-bloom');return n?.localName==='path'&&getComputedStyle(n).stroke==='none'&&Number(getComputedStyle(n).opacity)===0})()`));
  check('Manual selection adds solid regional fill, two static shadows and centered display growth', await evaluate(`(()=>{
    const node=document.querySelector('.graph-node.is-primary'),aura=document.querySelector('.node-aura[data-aura-id="'+node.dataset.id+'"]');
    const elevation=aura.querySelector('.node-folder-elevation'),style=elevation&&getComputedStyle(elevation);
    const context=document.createElement('canvas').getContext('2d'),normalize=value=>{context.fillStyle=value;return context.fillStyle};
    const face=aura.querySelector('.node-folder-face');
    return Number(node.dataset.emphasisScale)===1.12&&aura.classList.contains('is-elevated')
      &&elevation?.dataset.elevationState==='selection'&&elevation.children.length===2
      &&style.display!=='none'&&style.animationName==='none'&&!aura.querySelector('[class*="node-ember"]')
      &&normalize(getComputedStyle(face).fill)===normalize(getComputedStyle(aura).getPropertyValue('--folder-edge'))
      &&getComputedStyle(face).stroke==='none'&&!aura.classList.contains('is-inverted');
  })()`));
  check('Activating a node shows two circular, finite, non-interactive ripple rings', await evaluate(`(()=>{
    const ripple=document.querySelector('.graph-node.is-selected .node-click-ripple');
    const rings=[...document.querySelectorAll('.node-click-ripple-ring')];
    return !!ripple&&Number(ripple.dataset.progress)>=0&&Number(ripple.dataset.progress)<1
      &&getComputedStyle(ripple).pointerEvents==='none'&&rings.length===2
      &&rings.every(ring=>ring.localName==='circle'&&getComputedStyle(ring).pointerEvents==='none'
        &&['cx','cy','r'].every(name=>Number.isFinite(Number(ring.getAttribute(name))))
        &&Number(ring.getAttribute('r'))>0
        &&Math.abs(ring.getBoundingClientRect().width-ring.getBoundingClientRect().height)<.5)
      &&rings.some(ring=>Number(getComputedStyle(ring).opacity)>0);
  })()`));
  check('Node and connector text stays sharp', await noBlurredText());
  check('Selected node remains clear while unrelated regions remain faded', await evaluate(`Number(getComputedStyle(document.querySelector('.graph-node.is-selected')).opacity)>=.99&&[...document.querySelectorAll('.graph-node:not([data-section="land"]):not(.is-selected):not(.is-neighbor)')].every(n=>n.classList.contains('is-region-muted')&&Number(getComputedStyle(n).opacity)<=.22)`));
  check('Default node auras mirror node selection and neighboring fade', await auraStateMatchesNodes());
  const beforeZoom = await evaluate('document.getElementById("diagram").getAttribute("viewBox")');
  const selectionSoftness = `(()=>{const primary=document.querySelector('.glow-node.is-primary'),aura=document.querySelector('.node-aura[data-aura-id="'+primary.dataset.glowId+'"]'),n=aura.querySelector('.node-folder-shadow-cast'),id=n.getAttribute('filter').match(/#([^)"']+)/)[1],blur=document.getElementById(id).querySelector('feGaussianBlur');return Number(blur.getAttribute('stdDeviation'))*n.getScreenCTM().a})()`;
  const glowWidthBefore = await evaluate(selectionSoftness);
  await click('zoom-in');
  check('Glow remains present while zoom changes the view', beforeZoom !== await evaluate('document.getElementById("diagram").getAttribute("viewBox")') && (await glowState()).children > 0);
  const glowWidthAfter = await evaluate(selectionSoftness);
  details.zoomSelectionSoftness = { before: glowWidthBefore, after: glowWidthAfter };
  check('Neutral elevation shadows stay bounded and their faces stay aligned while zooming', glowWidthBefore > 0 && glowWidthAfter > 0 && Math.max(glowWidthBefore, glowWidthAfter) <= 5.55 && await glowTracksGeometry());
  await screenshot('focus-node-paper');
  await click('zoom-out');
  await screenshot('reference-rect-diamond-paper');
  await click('zoom-in');
  await click('close-inspector');
  const afterClose = await sectionState('land');
  check('Closing the inspector restores the active section focus', ['node', 'edge', 'note'].every(kind => afterClose[kind].localClear && afterClose[kind].otherMuted));
  check('Closing the inspector clears the selection glow', (await glowState()).children === 0);

  // An explicit query and an explicit selection outside the current section stay readable.
  await click('index-button'); await click('nodes-tab');
  await evaluate(`document.getElementById('search-input').value='EM08';document.getElementById('search-input').dispatchEvent(new Event('input'))`);
  await flushGraphStyles();
  await delay(280);
  const outsideId = await evaluate(`document.querySelector('#search-results .result-button').dataset.nodeId`);
  const outsideSelector = `.graph-node[data-id="${outsideId}"]`;
  check('A search match in another section is not faded', await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(outsideSelector)});return n.dataset.section!=='land'&&!n.classList.contains('is-region-muted')&&!n.classList.contains('is-dimmed')&&Number(getComputedStyle(n).opacity)>=.99})()`));
  await click('close-index');
  check('Closing search restores fading for the other section', await evaluate(`document.querySelector(${JSON.stringify(outsideSelector)}).classList.contains('is-region-muted')`));
  await activate(outsideSelector);
  check('An explicitly selected node outside the current section is fully visible', await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(outsideSelector)});return n.classList.contains('is-selected')&&!n.classList.contains('is-region-muted')&&Number(getComputedStyle(n).opacity)>=.99})()`));
  check('Selecting an outside node does not change any section ownership', identitiesBefore === await evaluate(`JSON.stringify([...document.querySelectorAll('.graph-node,.graph-edge,.graph-note')].map(n=>[n.dataset.id,n.dataset.section]))`));
  await click('close-inspector');

  await region('grid');
  const outsideEdge = await evaluate(`document.querySelector('.graph-edge[data-section="land"]').dataset.id`);
  await activate(`.graph-edge[data-id="${outsideEdge}"]`);
  const edgeGlow = await glowState(); details.edgeGlow = { ...edgeGlow, markup: undefined };
  check('An explicitly selected outside connector is clear and has glow', edgeGlow.primaryEdges === 1 && await evaluate(`(()=>{const e=document.querySelector('.graph-edge[data-id="${outsideEdge}"]');return e.classList.contains('is-selected')&&!e.classList.contains('is-region-muted')&&Number(getComputedStyle(e).opacity)>=.99})()`));
  check('Selected connector glow follows the actual display route', await evaluate(`document.querySelector('.glow-edge.is-primary .glow-core').getAttribute('d')===document.querySelector('.graph-edge[data-id="${outsideEdge}"] .edge-line').getAttribute('d')`));
  check('Both endpoints of a selected connector remain visible', await evaluate(`[...document.querySelectorAll('.graph-node.is-selected')].length===2&&[...document.querySelectorAll('.graph-node.is-selected')].every(n=>!n.classList.contains('is-region-muted')&&Number(getComputedStyle(n).opacity)>=.99)`));
  check('Glow does not blur selected connector text', await noBlurredText());
  await click('close-inspector');

  await region('land'); await activate(landNode); await click('theme-night');
  check('Night mode keeps selected glow and regional focus', (await glowState()).children > 0 && await evaluate(`document.documentElement.dataset.theme==='night'&&document.querySelector('[data-region="land"]').getAttribute('aria-current')==='true'&&document.querySelectorAll('.graph-node.is-region-muted').length>0`));
  check('Night mode keeps graph text outside blur filters', await noBlurredText());
  check('Night mode preserves regional frost colors and static grain', await frostedRegionColors() && await staticFrostedGrain());
  await screenshot('focus-node-night');
  await click('close-inspector'); await region('environment');
  await screenshot('focus-environment-night');
  const nightRegion = await sectionState('environment');
  check('Night mode uses the same module focus rules', ['node', 'edge', 'note'].every(kind => nightRegion[kind].localClear && nightRegion[kind].otherMuted));

  // Layout editing must move the decorative geometry with the actual snapped node.
  await region('land'); await click('edit-layout'); await activate(landNode);
  const glowPositionBefore = await primaryGlowCenter();
  await evaluate(`document.querySelector(${JSON.stringify(landNode)}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`document.getElementById('diagram').getAttribute('aria-busy')!=='true'&&!document.getElementById('layout-undo').disabled`)) break;
    await delay(100);
  }
  check('Snapped node editing updates the glow position and connected glow paths', JSON.stringify(glowPositionBefore) !== JSON.stringify(await primaryGlowCenter()) && await glowTracksGeometry());
  check('Layout editing preserves module focus and source ownership', await evaluate(`document.getElementById('diagram').dataset.activeRegion==='land'&&[...document.querySelectorAll('.graph-node.is-region-muted')].every(n=>n.dataset.section!=='land')`) && identitiesBefore === await evaluate(`JSON.stringify([...document.querySelectorAll('.graph-node,.graph-edge,.graph-note')].map(n=>[n.dataset.id,n.dataset.section]))`));
  check('Snapped display editing does not rewrite base card geometry', await sourceGeometryMatches());
  await click('layout-undo');
  check('Undo returns node and connector glow to the restored geometry', JSON.stringify(glowPositionBefore) === JSON.stringify(await primaryGlowCenter()) && await glowTracksGeometry());
  await click('edit-layout');

  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await region('land'); await activate(landNode);
  check('Mobile selected glow remains visible without page overflow', (await glowState()).children > 0 && await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  check('Mobile inspector and section navigation remain available', await evaluate(`!document.getElementById('inspector').hidden&&[...document.querySelectorAll('.rail-item')].every(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})`));
  await screenshot('focus-mobile-night');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await activate(landNode);
  check('Reduced motion keeps static elevation and skips click ripple animation', (await glowState()).children > 0 && await evaluate(`document.querySelectorAll('.node-click-ripple,.node-click-ripple-ring').length===0&&[...document.querySelectorAll('.node-folder-elevation')].every(n=>getComputedStyle(n).animationName==='none')`));
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  check('No browser runtime errors', errors.length === 0);
  await writeFile('.preview/focus-browser-report.json', JSON.stringify({ status: Object.values(checks).every(Boolean) ? 'passed' : 'failed', checks, details, runtimeErrors: errors, browserExtensionErrors: extensionErrors }, null, 2));
  console.log(JSON.stringify({ checks, runtimeErrors: errors.length, browserExtensionErrors: extensionErrors.length }));
  assert(Object.values(checks).every(Boolean), JSON.stringify(Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)));
  }
} finally {
  if (originalStorage) await evaluate(`(() => {const previous=${JSON.stringify(originalStorage)};for(const [key,value] of [['frame12-layout-v1',previous.layout],['frame12-theme',previous.theme]]){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}})()`).catch(() => {});
  socket.close();
  await fetch(`${debug}/json/close/${page.id}`).catch(() => {});
}
