// Discover -> Overview integration checks against the existing local app / browser.
// Start the app on 4173 and Chromium with CDP on 9224 before running this script.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.APP_BASE_URL || 'http://127.0.0.1:4173';
const debug = `http://127.0.0.1:${process.env.EDGE_DEBUG_PORT || 9224}`;
const inspectorOnly = process.env.UNTANGLE_SCENARIO === 'inspector';
const page = await (await fetch(`${debug}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0, savedTheme, savedLayout;
const pending = new Map(), runtimeErrors = [], checks = [];
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
function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
}
async function until(expression, description, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await evaluate(expression)) return;
    await pause(60);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const ready = `document.querySelectorAll('#diagram .graph-node').length===128 && document.getElementById('loading-state').hidden`;
const landscapeReady = `!document.getElementById('landscape-panel').hidden && document.querySelectorAll('.landscape-node').length===128`;
const overviewReady = `!document.getElementById('diagram-wrap').hidden && document.getElementById('landscape-panel').hidden && !document.querySelector('.landscape-transition') && document.getElementById('view-name').textContent==='Overview'`;
const geometryExpression = `JSON.stringify({
  nodes:[...document.querySelectorAll('#diagram .graph-node')].map(n=>[n.dataset.id,n.getAttribute('transform'),n.dataset.layoutX,n.dataset.layoutY,n.querySelector('.node-shape').outerHTML]),
  edges:[...document.querySelectorAll('#diagram .edge-line')].map(n=>[n.closest('[data-id]').dataset.id,n.getAttribute('d')])
})`;
const topicsExpression = `JSON.stringify([...document.querySelectorAll('#landscape-topics button[aria-pressed="true"]')].map(n=>n.dataset.topic))`;
const positionsExpression = `JSON.stringify([...document.querySelectorAll('.landscape-node')].map(n=>[n.dataset.id,n.getAttribute('transform')]))`;
async function screenshot(name) {
  await evaluate('document.fonts.ready');
  const result = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(`.preview/untangle-${name}.png`, Buffer.from(result.data, 'base64'));
}
async function settled() {
  let last = await evaluate(positionsExpression), stable = 0;
  for (let i = 0; i < 100; i++) {
    await pause(80);
    const current = await evaluate(positionsExpression);
    stable = current === last ? stable + 1 : 0;
    if (stable >= 2) return current;
    last = current;
  }
  throw new Error('Landscape positions did not settle');
}
async function enterLandscape() {
  await click('landscape-button');
  await until(landscapeReady, 'Landscape');
  await settled();
}
async function beginTransition() {
  await click('landscape-overview');
  await until(`!!document.querySelector('.landscape-transition')`, 'the untangling overlay');
}
async function overlaySnapshot() {
  return evaluate(`(()=>{
    const root=document.querySelector('.landscape-transition');
    if(!root)return null;
    const paths=[...root.querySelectorAll('path')].filter(path=>path.getAttribute('d'));
    const visibleShapes=[...root.querySelectorAll('circle,rect,ellipse,polygon,path')];
    const bounds=visibleShapes.map(el=>{const b=el.getBBox();return[b.x,b.y,b.width,b.height]});
    return {
      progress:Number(root.dataset.progress),
      phase:root.dataset.phase,
      finite:bounds.every(box=>box.every(Number.isFinite))&&paths.every(path=>!/(?:NaN|Infinity|undefined)/.test(path.getAttribute('d'))),
      pathCount:paths.length,
      shapeCount:visibleShapes.length,
      nodeCount:root.querySelectorAll('.transition-node').length,
      sourceCount:root.querySelectorAll('.transition-edge[data-kind="source"]').length,
      targetNodeCount:Number(root.dataset.targetNodeCount),
      targetEdgeCount:Number(root.dataset.targetEdgeCount),
      nodeGeometry:JSON.stringify([...root.querySelectorAll('.transition-node')].map(el=>[el.dataset.id,el.getAttribute('d')])),
      edgeGeometry:JSON.stringify([...root.querySelectorAll('.transition-edge[data-kind="source"]')].map(el=>el.getAttribute('d'))),
      rect:(()=>{const b=root.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}})()
    };
  })()`);
}
async function completeTransition() {
  await until(overviewReady, 'Overview after untangling');
  await pause(100);
}
await mkdir('.preview', { recursive: true });
try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.bringToFront');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await until(ready, 'the source diagram');
  savedTheme = await evaluate(`localStorage.getItem('frame12-theme')`);
  savedLayout = await evaluate(`localStorage.getItem('frame12-layout-v1')`);
  await click('theme-paper');
  const sourceGeometry = await evaluate(geometryExpression);

  if (!inspectorOnly) {
  const navigation = await evaluate(`(()=>{
    const headings=[...document.querySelectorAll('.rail-heading')],discover=headings.find(n=>n.textContent.trim()==='Discover'),explore=headings.find(n=>n.textContent.trim()==='Explore');
    const landscape=document.getElementById('landscape-button'),overview=document.querySelector('.rail [data-region="all"]');
    return {
      headings:headings.map(n=>n.textContent.trim()),
      domOrder:!!(discover.compareDocumentPosition(explore)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(landscape.compareDocumentPosition(overview)&Node.DOCUMENT_POSITION_FOLLOWING),
      visualOrder:discover.getBoundingClientRect().top<explore.getBoundingClientRect().top&&landscape.getBoundingClientRect().top<overview.getBoundingClientRect().top
    };
  })()`);
  check('Discover appears above Explore in document and visual order', navigation.domOrder && navigation.visualOrder, navigation);
  await enterLandscape();
  check('Landscape exposes an enabled, visible Untangle to overview button', await evaluate(`(()=>{
    const b=document.getElementById('landscape-overview'),r=b.getBoundingClientRect();
    return !b.disabled&&/untangle to overview/i.test(b.textContent)&&r.width>0&&r.height>0;
  })()`));
  await screenshot('scatter');
  await beginTransition();
  const initial = await overlaySnapshot();
  check('Original Landscape labels do not remain painted beneath the animated snapshot', await evaluate(`(()=>{
    return [...document.querySelectorAll('#landscape-diagram .landscape-node-label')].every(label=>{
      if(getComputedStyle(label).visibility==='hidden')return true;
      for(let el=label;el;el=el.parentElement){
        const style=getComputedStyle(el);
        if(style.display==='none'||Number(style.opacity)===0)return true;
      }
      return false;
    });
  })()`));
  await pause(450);
  const midpoint = await overlaySnapshot();
  check('Untangling renders finite node and connection geometry', initial?.finite && initial.pathCount >= 181 && initial.shapeCount >= 128, initial && { pathCount: initial.pathCount, shapeCount: initial.shapeCount, phase: initial.phase });
  check('Every animated source node and connection maps to its real Overview counterpart', initial?.nodeCount === 128 && initial.sourceCount === 181 && initial.targetNodeCount === 128 && initial.targetEdgeCount === 181);
  check('The animation actually moves nodes and reroutes connections over time', midpoint?.finite && initial.nodeGeometry !== midpoint.nodeGeometry && initial.edgeGeometry !== midpoint.edgeGeometry, { startPhase: initial?.phase, middlePhase: midpoint?.phase, startProgress: initial?.progress, middleProgress: midpoint?.progress });
  await screenshot('midpoint');
  await click('landscape-overview');
  check('Repeated activation keeps a single transition overlay', await evaluate(`document.querySelectorAll('.landscape-transition').length===1`));
  await until(`Number(document.querySelector('.landscape-transition')?.dataset.progress)>=.79`, 'the final routed transition frame');
  const aligned = await evaluate(`(()=>{
    const nodes=[...document.querySelectorAll('.transition-node')],edges=[...document.querySelectorAll('.transition-edge[data-kind="source"]')];
    const nodesAligned=nodes.every(node=>{
      const target=document.querySelector('#diagram .graph-node[data-id="'+node.dataset.id+'"] .node-shape');
      const a=node.getBoundingClientRect(),b=target.getBoundingClientRect();
      return node.localName==='path'&&Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)<.25
        &&[0,.125,.25,.375,.5,.625,.75,.875,1].every(t=>{
          const p=node.getPointAtLength(node.getTotalLength()*t).matrixTransform(node.getScreenCTM());
          const q=target.getPointAtLength(target.getTotalLength()*t).matrixTransform(target.getScreenCTM());
          return Math.hypot(p.x-q.x,p.y-q.y)<.25;
        });
    });
    const edgesAligned=edges.every(edge=>{
      const target=document.querySelector('#diagram .graph-edge[data-id="'+edge.dataset.id+'"] .edge-line');
      if(edge.getAttribute('d')!==target.getAttribute('d'))return false;
      return [0,1].every(end=>{
        const a=edge.getPointAtLength(edge.getTotalLength()*end).matrixTransform(edge.getScreenCTM());
        const b=target.getPointAtLength(target.getTotalLength()*end).matrixTransform(target.getScreenCTM());
        return Math.hypot(a.x-b.x,a.y-b.y)<.25;
      });
    });
    return {nodesAligned,edgesAligned};
  })()`);
  check('The last frame aligns with actual Overview folder variants, positions and connector routes', aligned.nodesAligned && aligned.edgesAligned, aligned);
  await completeTransition();
  await screenshot('overview');
  check('Untangling ends on active Explore / Overview with the overlay removed', await evaluate(`(()=>{
    const b=document.querySelector('.rail [data-region="all"]');
    return b.classList.contains('active')&&b.getAttribute('aria-current')==='true'&&!document.getElementById('landscape-button').classList.contains('active')&&!document.querySelector('.landscape-transition')&&!location.hash.includes('view=landscape');
  })()`));
  check('All 128 source nodes and 181 connections remain unchanged after transition', await evaluate(`document.querySelectorAll('#diagram .graph-node').length===128&&document.querySelectorAll('#diagram .graph-edge').length===181`) && await evaluate(geometryExpression) === sourceGeometry);
  check('Transition leaves saved local source layout untouched', await evaluate(`localStorage.getItem('frame12-layout-v1')`) === savedLayout);
  await evaluate(`document.querySelector('#diagram .graph-node').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  check('The resulting Overview remains interactive', await evaluate(`!document.getElementById('inspector').hidden&&!!document.querySelector('#diagram .graph-node.is-selected')`));
  await click('close-inspector');

  await enterLandscape();
  await evaluate(`document.querySelector('#landscape-topics [data-topic="grid"]').click();document.querySelector('#landscape-topics [data-topic="government"]').click()`);
  await settled();
  const selectedTopics = await evaluate(topicsExpression);
  await beginTransition();
  await completeTransition();
  await enterLandscape();
  check('Replaying from a clustered network preserves the selected topics', await evaluate(topicsExpression) === selectedTopics);
  check('Repeated transitions preserve source node positions and line paths', await evaluate(geometryExpression) === sourceGeometry);

  await beginTransition();
  await evaluate(`document.querySelector('.rail [data-region="grid"]').click()`);
  await until(`document.getElementById('view-name').textContent==='Grid'&&!document.querySelector('.landscape-transition')`, 'navigation cancellation');
  await pause(2100);
  check('Choosing another Explore section cancels the transition without a late Overview redirect', await evaluate(`document.getElementById('view-name').textContent==='Grid'&&document.querySelector('.rail [data-region="grid"]').classList.contains('active')&&!document.querySelector('.landscape-transition')&&!document.getElementById('landscape-overview').disabled`));

  await enterLandscape();
  await beginTransition();
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector('.landscape-transition')`, 'Escape cancellation');
  check('Escape safely cancels the animation and restores Landscape controls', await evaluate(`${landscapeReady}&&!document.getElementById('landscape-overview').disabled`));

  await beginTransition();
  await click('cancel-overview-transition');
  check('The visible Cancel button returns to the current Landscape', await evaluate(`${landscapeReady}&&!document.querySelector('.landscape-transition')&&!document.getElementById('landscape-overview').disabled`));

  await beginTransition();
  await evaluate(`location.hash='#view=landscape&topics=environment'`);
  await until(`!document.querySelector('.landscape-transition')&&document.querySelector('#landscape-topics [data-topic="environment"]').getAttribute('aria-pressed')==='true'`, 'hash navigation cancellation');
  check('Hash navigation cancels the animation and respects the requested topic', await evaluate(`${landscapeReady}&&${topicsExpression}==='["environment"]'`));

  await settled();
  await beginTransition();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await until(`!document.querySelector('.landscape-transition')`, 'resize completion or cancellation');
  check('Resizing during the animation removes the overlay and restores usable controls', await evaluate(`!document.getElementById('landscape-overview').disabled&&document.documentElement.scrollWidth<=innerWidth&&(!document.getElementById('diagram-wrap').hidden||!document.getElementById('landscape-panel').hidden)`));

  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await enterLandscape();
  await click('theme-night');
  await pause(200);
  await screenshot('dark-scatter');
  await beginTransition();
  await pause(500);
  const dark = await overlaySnapshot();
  check('Dark mode supports the animated transition with finite paths', dark?.finite && await evaluate(`document.documentElement.dataset.theme==='night'`));
  await screenshot('dark-midpoint');
  await completeTransition();
  await screenshot('dark-overview');

  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await enterLandscape();
  check('The untangle button stays fully visible on mobile', await evaluate(`(()=>{
    const r=document.getElementById('landscape-overview').getBoundingClientRect();
    return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;
  })()`));
  await click('theme-paper');
  await pause(200);
  await screenshot('mobile-scatter');
  await beginTransition();
  await pause(500);
  const mobile = await overlaySnapshot();
  check('Mobile animation remains finite and inside the viewport', mobile?.finite && mobile.rect.x >= -1 && mobile.rect.x + mobile.rect.width <= 391 && await evaluate(`document.documentElement.scrollWidth<=innerWidth`), mobile?.rect);
  await screenshot('mobile-midpoint');
  await completeTransition();
  await screenshot('mobile-overview');
  check('Mobile completes into a usable Overview', await evaluate(`${overviewReady}&&document.documentElement.scrollWidth<=innerWidth`));

  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await enterLandscape();
  const reducedStart = await evaluate(`(()=>{
    const start=performance.now();document.getElementById('landscape-overview').click();return start;
  })()`);
  await until(overviewReady, 'reduced-motion Overview');
  const reduced = await evaluate(`({elapsed:performance.now()-${reducedStart},overlay:!!document.querySelector('.landscape-transition')})`);
  check('Reduced motion switches promptly to Overview without playing the animation', reduced.elapsed < 750 && !reduced.overlay, reduced);
  await cdp('Emulation.setEmulatedMedia', { features: [] });

  // Use an isolated, temporary display offset to cover locally edited layouts.
  // Original storage is restored even if a check below fails.
  const customLayout = await evaluate(`(async()=>{
    const previous=JSON.parse(localStorage.getItem('frame12-layout-v1')||'null');
    const layout={version:1,nodes:{...(previous?.nodes||{})},edges:{...(previous?.edges||{})}};
    const node=document.querySelector('#diagram .graph-node');
    const source=await(await fetch('data/frame12.json')).json();
    const box=source.nodes.find(item=>item.node_id===node.dataset.id).layout;
    layout.nodes[node.dataset.id]={x:Number(node.dataset.layoutX)+box.width*.125+40,y:Number(node.dataset.layoutY)+box.height*.125};
    const value=JSON.stringify(layout);localStorage.setItem('frame12-layout-v1',value);return value;
  })()`);
  await cdp('Page.reload');
  await until(ready, 'the custom display layout');
  const customGeometry = await evaluate(geometryExpression);
  check('The custom-layout check loads a real persisted display offset', customGeometry !== sourceGeometry);
  await enterLandscape();
  await beginTransition();
  await completeTransition();
  check('Untangling respects custom node positions and source connector paths', await evaluate(geometryExpression) === customGeometry && await evaluate(`localStorage.getItem('frame12-layout-v1')`) === customLayout);
  }

  await enterLandscape();
  await evaluate(`document.querySelector('.landscape-node').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(`!document.getElementById('inspector').hidden`, 'the Landscape node inspector');
  await pause(250);
  check('Inspector-start scenario begins with a selected and dimmed Landscape', await evaluate(`!!document.querySelector('.landscape-node.is-selected')&&!!document.querySelector('.landscape-node.is-dimmed')`));
  await beginTransition();
  const inspectorSnapshot = await evaluate(`({
    count:document.querySelectorAll('.transition-node').length,
    allOpaque:[...document.querySelectorAll('.transition-node')].every(node=>Number(node.getAttribute('opacity'))===1),
    inspectorClosed:document.getElementById('inspector').hidden
  })`);
  check('Untangling from an open inspector restores full opacity for all source nodes', inspectorSnapshot.count === 128 && inspectorSnapshot.allOpaque && inspectorSnapshot.inspectorClosed, inspectorSnapshot);
  await pause(500);
  await screenshot('inspector-midpoint');
  await click('cancel-overview-transition');
  check('Cancel after an inspector-start restores the full Landscape without a stale overlay', await evaluate(`${landscapeReady}&&!document.querySelector('.landscape-transition')&&!document.getElementById('landscape-overview').disabled&&getComputedStyle(document.getElementById('landscape-diagram')).opacity==='1'`));

  check('No browser runtime exceptions occurred', runtimeErrors.length === 0, runtimeErrors);
  const failures = checks.filter(item => !item.passed);
  const report = { status: failures.length ? 'failed' : 'passed', checks, runtimeErrors };
  await writeFile(`.preview/untangle${inspectorOnly ? '-inspector' : ''}-browser-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(failures, [], 'Discover / Overview checks failed');
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile(`.preview/untangle${inspectorOnly ? '-inspector' : ''}-browser-report.json`, JSON.stringify({
    status: 'failed', checks, runtimeErrors, error: error.stack || String(error),
  }, null, 2));
  throw error;
} finally {
  if (savedLayout !== undefined) {
    await evaluate(`localStorage.${savedLayout === null ? 'removeItem' : 'setItem'}('frame12-layout-v1'${savedLayout === null ? '' : `,${JSON.stringify(savedLayout)}`})`).catch(() => {});
  }
  if (savedTheme !== undefined) {
    await evaluate(`localStorage.${savedTheme === null ? 'removeItem' : 'setItem'}('frame12-theme'${savedTheme === null ? '' : `,${JSON.stringify(savedTheme)}`})`).catch(() => {});
  }
  socket.close();
  await fetch(`${debug}/json/close/${page.id}`).catch(() => {});
}
