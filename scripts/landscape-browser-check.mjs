// Focused Landscape integration checks through an existing Chromium CDP session.
// Start the app on port 4173 and a browser on port 9224 before running this file.
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
function check(name, passed, detail) { checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); }
async function until(expression, description, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function click(id) { return evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function screenshot(name) {
  await evaluate('document.fonts.ready');
  await pause(120);
  const image = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(`.preview/landscape-${name}.png`, Buffer.from(image.data, 'base64'));
}
const positionsExpression = `Object.fromEntries([...document.querySelectorAll('.landscape-node')].map(node=>[node.dataset.id,node.getAttribute('transform')]))`;
async function settledPositions() {
  let previous = await evaluate(positionsExpression);
  for (let attempt = 0; attempt < 60; attempt++) {
    await pause(100);
    const current = await evaluate(positionsExpression);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  throw new Error('Landscape did not settle within six seconds');
}
const sourceGeometryExpression = `JSON.stringify([...document.querySelectorAll('.graph-node')].map(node=>[node.dataset.id,node.querySelector('.node-shape').outerHTML]))`;
const keyboardSelect = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
async function visibleNodePoint() {
  return evaluate(`(()=>{
    for(const node of document.querySelectorAll('.landscape-node')){
      const r=node.querySelector('.landscape-node-circle').getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      if(x>80&&x<innerWidth-100&&y>130&&y<innerHeight-100&&document.elementFromPoint(x,y)?.closest('.landscape-node')===node)return{id:node.dataset.id,x,y};
    }
    return null;
  })()`);
}
await mkdir('.preview', { recursive: true });
try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.bringToFront');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await until('document.querySelectorAll(".graph-node").length===128 && document.getElementById("loading-state").hidden && !!document.getElementById("landscape-button")', 'the source map and Landscape navigation');
  await click('theme-paper');
  const sourceGeometry = await evaluate(sourceGeometryExpression);
  const sourceData = await evaluate(`(async()=>await(await fetch('data/frame12.json')).json())()`);
  await click('landscape-button');
  await until('document.querySelectorAll(".landscape-node").length===128 && !document.getElementById("landscape-panel").hidden', 'the Landscape map');
  const scatterPositions = await settledPositions();
  const initial = await evaluate(`(()=>{
    const q=id=>document.getElementById(id),nodes=[...document.querySelectorAll('.landscape-node')];
    const topics=[...q('landscape-topics').querySelectorAll('button[data-topic]')];
    const finite=nodes.every(node=>{const m=node.transform.baseVal.consolidate()?.matrix;return m&&Number.isFinite(m.e)&&Number.isFinite(m.f)});
    const inferred=[...document.querySelectorAll('.landscape-edge[data-kind="inferred"]')];
    return {
      sourceHidden:q('diagram-wrap').hidden,
      noTopicsSelected:topics.length>=5&&topics.every(button=>button.getAttribute('aria-pressed')==='false'),
      generalTopics:['Grid','Environment','Government','Public Influence','Hearing'].every(label=>topics.some(button=>button.textContent.includes(label))),
      keyboardNodes:nodes.every(node=>node.getAttribute('tabindex')==='0'&&node.getAttribute('role')==='button'),
      finite,uniquePositions:new Set(nodes.map(node=>node.getAttribute('transform'))).size,
      sourceIds:[...document.querySelectorAll('.landscape-edge[data-kind="source"]')].map(edge=>edge.dataset.id),
      inferredCount:inferred.length,
      inferredDashed:inferred.length>0&&inferred.every(edge=>{const line=edge.querySelector('.landscape-edge-line');const dash=getComputedStyle(line).strokeDasharray;return dash!=='none'&&dash!=='0px'})
    };
  })()`);
  check('Landscape opens with all 128 keyboard-accessible nodes and the source map hidden', initial.sourceHidden && initial.keyboardNodes);
  check('Initial state is scattered, with no active topic and general topic choices', initial.noTopicsSelected && initial.generalTopics && initial.uniquePositions === 128);
  check('All original 181 connection IDs are preserved', initial.sourceIds.length === sourceData.connections.length && sourceData.connections.every(edge => initial.sourceIds.includes(edge.connection_id)));
  check('Inferred relationships are present and visually distinguished by dashed lines', initial.inferredCount > 0 && initial.inferredDashed);
  check('Every scatter position is finite', initial.finite);
  await screenshot('scatter');

  await evaluate(`document.querySelector('#landscape-topics button[data-topic="grid"]').click();document.querySelector('#landscape-topics button[data-topic="environment"]').click()`);
  const clusteredPositions = await settledPositions();
  const clustered = await evaluate(`({
    pressed:[...document.querySelectorAll('#landscape-topics button[aria-pressed="true"]')].map(button=>button.dataset.topic),
    anchors:[...document.querySelectorAll('.landscape-anchor')].map(anchor=>anchor.textContent),
    finite:[...document.querySelectorAll('.landscape-node')].every(node=>{const m=node.transform.baseVal.consolidate()?.matrix;return m&&Number.isFinite(m.e)&&Number.isFinite(m.f)})
  })`);
  const movedNodes = Object.keys(scatterPositions).filter(id => scatterPositions[id] !== clusteredPositions[id]).length;
  check('Grid and Environment can cluster together', clustered.pressed.length === 2 && clustered.pressed.includes('grid') && clustered.pressed.includes('environment'));
  check('Clustering moves nodes to finite topic positions', movedNodes >= 64 && clustered.finite, { movedNodes });
  check('Selected topic anchors explain the clusters', clustered.anchors.some(label => label.includes('Grid')) && clustered.anchors.some(label => label.includes('Environment')));
  await screenshot('clustered');
  await click('labels-toggle');
  check('The shared Labels control hides Landscape node labels', await evaluate(`[...document.querySelectorAll('.landscape-node-label')].every(label=>getComputedStyle(label).visibility==='hidden'||getComputedStyle(label).display==='none')`));
  await click('labels-toggle');
  check('The Labels control can restore visible Landscape labels', await evaluate(`[...document.querySelectorAll('.landscape-node-label')].some(label=>getComputedStyle(label).visibility==='visible'&&getComputedStyle(label).display!=='none')`));

  const pointerNode = await visibleNodePoint();
  assert(pointerNode, 'At least one Landscape node must be visible and pointer accessible');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: pointerNode.x, y: pointerNode.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointerNode.x, y: pointerNode.y, button: 'left', clickCount: 1 });
  check('An actual pointer click selects a node and opens its inspector', await evaluate(`!document.getElementById('inspector').hidden && document.querySelector('.landscape-node.is-selected')?.dataset.id===${JSON.stringify(pointerNode.id)}`));
  await click('close-inspector');
  await click('fit-button');
  await pause(250);
  const dragNode = await visibleNodePoint();
  assert(dragNode, 'A Landscape node must remain pointer accessible after closing the inspector');
  const beforeDrag = await evaluate(`document.querySelector('.landscape-node[data-id="${dragNode.id}"]').getAttribute('transform')`);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragNode.x, y: dragNode.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragNode.x + 55, y: dragNode.y + 35, button: 'left', buttons: 1 });
  const movedOnDrag = beforeDrag !== await evaluate(`document.querySelector('.landscape-node[data-id="${dragNode.id}"]').getAttribute('transform')`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragNode.x + 55, y: dragNode.y + 35, button: 'left', clickCount: 1 });
  check('An actual node drag moves the node without opening an inspector', movedOnDrag && await evaluate(`document.getElementById('inspector').hidden`));
  await settledPositions();

  const node = sourceData.nodes.find(item => item.display_code === 'L01') || sourceData.nodes[0];
  await keyboardSelect(`.landscape-node[data-id="${node.node_id}"]`);
  const noteCheck = await evaluate(`(()=>{
    const node=${JSON.stringify(node)},q=id=>document.getElementById(id);
    const normalize=value=>value.replace(/\\s+/g,' ').trim();
    const plain=html=>new DOMParser().parseFromString(html,'text/html').body.textContent;
    const wanted=['Description','Evidence','Time Scope','Public Influence'].flatMap(name=>node.sections[name]||[]);
    const shown=[...q('inspector-content').querySelectorAll('.source-block')];
    return {
      open:!q('inspector').hidden,
      sameSourceNotes:shown.length===wanted.length&&shown.every((block,i)=>block.dataset.blockId===wanted[i].block_id&&normalize(block.textContent)===normalize(plain(wanted[i].render_html))),
      affinities:!!q('inspector-content').querySelector('.landscape-affinities'),
      selected:document.querySelector('.landscape-node.is-selected')?.dataset.id===node.node_id
    };
  })()`);
  check('Keyboard selection opens the source notes and topic affinity explanation', Object.values(noteCheck).every(Boolean), noteCheck);
  await screenshot('node-details');
  await click('close-inspector');

  const sourceEdge = sourceData.connections[0];
  await keyboardSelect(`.landscape-edge[data-kind="source"][data-id="${sourceEdge.connection_id}"]`);
  const endpoints = await evaluate(`[...document.querySelectorAll('#inspector-content .endpoint-link')].map(button=>button.dataset.nodeId)`);
  check('Source connection selection preserves endpoint direction', endpoints[0] === sourceEdge.start_node_id && endpoints[1] === sourceEdge.end_node_id);
  await click('close-inspector');
  await keyboardSelect('.landscape-edge[data-kind="inferred"]');
  const inference = await evaluate(`({
    open:!document.getElementById('inspector').hidden,
    explanation:/inferred|similarity|affinity/i.test(document.getElementById('inspector-content').textContent),
    sourceNotes:document.querySelectorAll('#inspector-content .source-block').length
  })`);
  check('Inferred relationships open a distinct explanation', inference.open && inference.explanation && inference.sourceNotes === 0);
  await click('close-inspector');

  await click('landscape-inferred');
  const inferenceVisibility = await evaluate(`({
    checked:document.getElementById('landscape-inferred').checked,
    hidden:[...document.querySelectorAll('.landscape-edge[data-kind="inferred"]')].every(edge=>getComputedStyle(edge).display==='none'&&edge.getAttribute('aria-hidden')==='true'&&edge.getAttribute('tabindex')==='-1'),
    sourceVisible:[...document.querySelectorAll('.landscape-edge[data-kind="source"]')].every(edge=>getComputedStyle(edge).display!=='none'&&edge.getAttribute('aria-hidden')!=='true')
  })`);
  check('The inferred relationship toggle hides inferred lines and removes keyboard focus', !inferenceVisibility.checked && inferenceVisibility.hidden, inferenceVisibility);
  check('Original source connections remain visible when inference is hidden', inferenceVisibility.sourceVisible);
  await click('landscape-inferred');
  await click('landscape-method');
  check('The method dialog explains the scoring', await evaluate(`document.getElementById('landscape-method-dialog').open && /cosine|similarity|affinity|score/i.test(document.getElementById('landscape-method-dialog').textContent)`));
  await evaluate(`document.getElementById('landscape-method-dialog').close()`);

  await click('index-button');
  await click('nodes-tab');
  await evaluate(`document.getElementById('search-input').value='L01';document.getElementById('search-input').dispatchEvent(new Event('input'))`);
  check('Search highlights matching Landscape nodes', await evaluate(`document.querySelectorAll('#search-results .result-button').length===1 && document.querySelectorAll('.landscape-node.is-query-match').length===1`));
  await evaluate(`document.querySelector('#search-results .result-button').click()`);
  await pause(100);
  check('Search selection stays in Landscape and opens the matching source note', await evaluate(`!document.getElementById('landscape-panel').hidden && document.getElementById('diagram-wrap').hidden && !document.getElementById('inspector').hidden && document.querySelector('.landscape-node.is-selected')?.dataset.id===${JSON.stringify(node.node_id)}`));
  await click('close-inspector');

  const view = () => evaluate(`JSON.stringify({viewBox:document.getElementById('landscape-diagram').getAttribute('viewBox'),camera:document.querySelector('.landscape-viewport').getAttribute('transform')})`);
  const beforeZoom = await view();
  await click('zoom-in');
  check('Zoom controls operate on the Landscape viewport', beforeZoom !== await view() && await evaluate(`!document.getElementById('landscape-panel').hidden`));
  const emptyPoint = await evaluate(`(()=>{
    const svg=document.getElementById('landscape-diagram'),r=svg.getBoundingClientRect();
    for(const fy of [.75,.6,.4,.25])for(const fx of [.7,.8,.5,.3]){
      const x=r.left+r.width*fx,y=r.top+r.height*fy,target=document.elementFromPoint(x,y);
      if(target&&svg.contains(target)&&!target.closest('.landscape-node,.landscape-edge'))return{x,y};
    }
    return{x:r.left+r.width*.7,y:r.top+r.height*.7};
  })()`);
  const beforePan = await view();
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...emptyPoint, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: emptyPoint.x - 65, y: emptyPoint.y - 40, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: emptyPoint.x - 65, y: emptyPoint.y - 40, button: 'left', clickCount: 1 });
  check('Pointer dragging pans the Landscape viewport', beforePan !== await view());
  const beforeWheel = await view();
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...emptyPoint, deltaY: -130, deltaX: 0 });
  await pause(100);
  check('Wheel zoom operates on the Landscape viewport', beforeWheel !== await view());
  await click('fit-button');
  await pause(100);
  check('Fit keeps Landscape active and produces a finite viewport', await evaluate(`!document.getElementById('landscape-panel').hidden && document.getElementById('landscape-diagram').getAttribute('viewBox').split(/[ ,]+/).map(Number).every(Number.isFinite)`));
  await click('landscape-reset');
  const resetPositions = await settledPositions();
  check('Reset clears all themes and returns nodes to a dispersed layout', await evaluate(`document.querySelectorAll('#landscape-topics button[aria-pressed="true"]').length===0 && document.querySelectorAll('.landscape-anchor').length===0 && !document.getElementById('landscape-diagram').classList.contains('is-clustered')`) && Object.keys(resetPositions).filter(id => resetPositions[id] !== clusteredPositions[id]).length >= 64);

  await click('theme-night');
  await screenshot('night');
  check('Dark mode remains active in Landscape', await evaluate(`document.documentElement.dataset.theme==='night' && !document.getElementById('landscape-panel').hidden && document.documentElement.scrollWidth<=innerWidth`));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(150);
  await click('fit-button');
  check('Mobile Landscape fits the viewport without page overflow', await evaluate(`(()=>{
    const panel=document.getElementById('landscape-panel').getBoundingClientRect(),svg=document.getElementById('landscape-diagram').getBoundingClientRect();
    return document.documentElement.scrollWidth<=innerWidth&&panel.left>=0&&panel.right<=innerWidth+1&&svg.width>0&&svg.height>0;
  })()`));
  await screenshot('mobile');
  await keyboardSelect(`.landscape-node[data-id="${node.node_id}"]`);
  check('The mobile source inspector remains within the viewport', await evaluate(`(()=>{
    const inspector=document.getElementById('inspector'),r=inspector.getBoundingClientRect();
    return !inspector.hidden&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth;
  })()`));
  await screenshot('mobile-details');
  await click('close-inspector');

  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`window.__landscapeOriginalRAF=window.requestAnimationFrame;window.__landscapeFrameRequests=0;window.requestAnimationFrame=function(callback){window.__landscapeFrameRequests++;return window.__landscapeOriginalRAF.call(window,callback)}`);
  await evaluate(`document.querySelector('#landscape-topics button[data-topic="government"]').click()`);
  await pause(100);
  const reducedBefore = await evaluate(positionsExpression);
  const frameRequestsBefore = await evaluate('window.__landscapeFrameRequests');
  await pause(350);
  const reducedAfter = await evaluate(positionsExpression);
  const frameRequestsAfter = await evaluate('window.__landscapeFrameRequests');
  await evaluate(`window.requestAnimationFrame=window.__landscapeOriginalRAF;delete window.__landscapeOriginalRAF;delete window.__landscapeFrameRequests`);
  check('Reduced motion settles without continuing position animation or animation frame requests', frameRequestsBefore === frameRequestsAfter && JSON.stringify(reducedBefore) === JSON.stringify(reducedAfter) && await evaluate(`[...document.querySelectorAll('.landscape-node')].every(node=>{const m=node.transform.baseVal.consolidate()?.matrix;return m&&Number.isFinite(m.e)&&Number.isFinite(m.f)})`));
  await screenshot('reduced-motion');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  await keyboardSelect(`.landscape-node[data-id="${node.node_id}"]`);
  const selectedHash = await evaluate('location.hash');
  await cdp('Page.reload');
  await until(`document.querySelectorAll('.graph-node').length===128 && document.querySelectorAll('.landscape-node').length===128 && document.getElementById('loading-state').hidden && !document.getElementById('inspector').hidden`, 'Landscape deep-link restoration');
  check('Reload restores the Landscape view, selected topic, node and night theme', await evaluate(`location.hash===${JSON.stringify(selectedHash)} && document.documentElement.dataset.theme==='night' && !document.getElementById('landscape-panel').hidden && document.querySelector('#landscape-topics button[data-topic="government"]').getAttribute('aria-pressed')==='true' && document.querySelector('.landscape-node.is-selected')?.dataset.id===${JSON.stringify(node.node_id)} && !!document.querySelector('#inspector-content .landscape-affinities')`));
  await click('close-inspector');
  const topicsOnlyHash = await evaluate('location.hash');
  await cdp('Page.reload');
  await until(`document.querySelectorAll('.landscape-node').length===128 && document.getElementById('loading-state').hidden`, 'the topics-only Landscape deep link');
  check('A topics-only deep link survives reload without reopening a stale inspector', await evaluate(`location.hash===${JSON.stringify(topicsOnlyHash)} && !document.getElementById('landscape-panel').hidden && document.getElementById('inspector').hidden && document.querySelector('#landscape-topics button[data-topic="government"]').getAttribute('aria-pressed')==='true' && !document.querySelector('.landscape-node.is-selected')`));
  await evaluate(`document.querySelector('[data-region="all"]').click()`);
  await pause(150);
  check('Returning to Overview restores the source map with identical source geometry', await evaluate(`!document.getElementById('diagram-wrap').hidden && document.getElementById('landscape-panel').hidden && document.querySelectorAll('.graph-node').length===128 && document.querySelectorAll('.graph-edge').length===181`) && await evaluate(sourceGeometryExpression) === sourceGeometry);
  await click('theme-paper');
  check('No browser runtime exceptions', runtimeErrors.length === 0, runtimeErrors);
  const failures = checks.filter(item => !item.passed);
  const report = { status: failures.length ? 'failed' : 'passed', checks, runtimeErrors };
  await writeFile('.preview/landscape-browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(failures, [], 'Landscape integration checks failed');
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile('.preview/landscape-browser-report.json', JSON.stringify({
    status: 'failed', checks, runtimeErrors, error: error.stack || String(error),
  }, null, 2));
  throw error;
} finally {
  socket.close();
  await fetch(`${debug}/json/close/${page.id}`).catch(() => {});
}
