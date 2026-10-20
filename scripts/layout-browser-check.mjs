// Exercise editable display layouts with real pointer input against local Edge.
// Requires npm start and a DevTools endpoint (default port 9224).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:4173';
const debug = 'http://127.0.0.1:' + (process.env.EDGE_DEBUG_PORT || 9224);
const page = await (await fetch(debug + '/json/new?' + encodeURIComponent(base), { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map(), errors = [], checks = {};
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    message.error ? task?.reject(new Error(message.error.message)) : task?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
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
async function until(expression, description, timeout = 15000) {
  const started = Date.now();
  do {
    if (await evaluate(expression)) return;
    await delay(100);
  } while (Date.now() - started < timeout);
  throw new Error('Timed out: ' + description + '; layout status: ' + await evaluate('document.getElementById("layout-status")?.textContent'));
}
async function ready() {
  await until('document.querySelectorAll(".graph-node").length === 128 && document.getElementById("loading-state").hidden', 'diagram load');
  await evaluate('document.fonts.ready');
}
async function click(id) {
  await evaluate('document.getElementById(' + JSON.stringify(id) + ').click()');
  await delay(80);
}
async function key(key, code, modifiers = 0) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
}
async function drag(from, to, end = true) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 5; i++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5, button: 'left', buttons: 1 });
  }
  if (end) await release(to);
}
async function release(point) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
}
async function touchDrag(from, to) {
  const touch = point => [{ x: point.x, y: point.y, radiusX: 3, radiusY: 3, force: 1, id: 1 }];
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(from) });
  for (let i = 1; i <= 5; i++) await cdp('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: touch({ x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5 }),
  });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function screenshot(name) {
  await mkdir('.preview', { recursive: true });
  const image = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('.preview/' + name + '.png', Buffer.from(image.data, 'base64'));
}
function check(name, pass) {
  checks[name] = !!pass;
  assert(pass, name);
}
const nodeId = '3458764686135623224'; // L01
const nextNodeId = '3458764686135623226'; // L02
const edgeId = '3458764686135623288'; // L01 -> L02
const layoutKey = 'frame12-layout-v1';
const selector = id => '.graph-node[data-id="' + id + '"]';
async function nodePosition(id = nodeId) {
  return evaluate('(() => {const group=document.querySelector(' + JSON.stringify(selector(id)) + '), shape=group.querySelector(".node-shape"), b=shape.getBBox(), svg=document.getElementById("diagram"), screen=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(shape.getScreenCTM()), world=screen.matrixTransform(svg.getScreenCTM().inverse());return {x:world.x,y:world.y,screen:{x:screen.x,y:screen.y},source:{x:b.x,y:b.y,width:b.width,height:b.height},step:Number(svg.dataset.gridStep),scale:svg.getScreenCTM().a}})()');
}
async function screenPoint(point) {
  return evaluate('(() => {const p=new DOMPoint(' + point.x + ',' + point.y + ').matrixTransform(document.getElementById("diagram").getScreenCTM());return {x:p.x,y:p.y}})()');
}
async function storage() {
  return evaluate('JSON.parse(localStorage.getItem(' + JSON.stringify(layoutKey) + ') || "null")');
}
const close = (a, b, tolerance = .01) => Math.abs(a - b) < tolerance;
const positionEquals = (a, b) => close(a.x, b.x) && close(a.y, b.y);
async function focusNode() {
  await evaluate('document.querySelector(' + JSON.stringify(selector(nodeId)) + ').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
  await delay(200);
  await click('close-inspector');
  await delay(150);
}
async function editMode(enabled = true) {
  const current = await evaluate('document.getElementById("diagram").dataset.editing === "true"');
  if (current !== enabled) await click('edit-layout');
  await until('document.getElementById("diagram").dataset.editing === "' + enabled + '"', 'edit mode');
}
async function saved() {
  await until('/Saved/i.test(document.getElementById("layout-status").textContent)', 'layout save');
}
async function pathPoints(id = edgeId) {
  return evaluate('(() => {const path=document.querySelector(".graph-edge[data-id=\\"' + id + '\\"] .edge-line");const values=path.getAttribute("d").match(/-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?/gi).map(Number);return Array.from({length:values.length/2},(_,i)=>({x:values[i*2],y:values[i*2+1]}))})()');
}
async function attachedEndpoints() {
  return evaluate('(async () => {const data=await(await fetch("data/frame12.json")).json(), svg=document.getElementById("diagram"), map=new Map(data.nodes.map(n=>[n.node_id,n]));const boundary=(point,id)=>{const n=map.get(id),shape=document.querySelector(".graph-node[data-id=\\""+id+"\\"] .node-shape"),local=new DOMPoint(point.x,point.y).matrixTransform(svg.getScreenCTM()).matrixTransform(shape.getScreenCTM().inverse()),b=shape.getBBox(),cx=b.x+b.width/2,cy=b.y+b.height/2;if(n.shape==="rhombus")return Math.abs(Math.abs(local.x-cx)/(b.width/2)+Math.abs(local.y-cy)/(b.height/2)-1)<.001;return local.x>=b.x-.01&&local.x<=b.x+b.width+.01&&local.y>=b.y-.01&&local.y<=b.y+b.height+.01&&Math.min(Math.abs(local.x-b.x),Math.abs(local.x-b.x-b.width),Math.abs(local.y-b.y),Math.abs(local.y-b.y-b.height))<.01};return data.connections.every(e=>{const p=document.querySelector(".graph-edge[data-id=\\""+e.connection_id+"\\"] .edge-line");return boundary(p.getPointAtLength(0),e.start_node_id)&&boundary(p.getPointAtLength(p.getTotalLength()),e.end_node_id)})})()');
}
let originalStorage;
try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await ready();
  originalStorage = await evaluate('({layout:localStorage.getItem("frame12-layout-v1"),theme:localStorage.getItem("frame12-theme")})');
  await evaluate('localStorage.removeItem("frame12-layout-v1");location.hash=""');
  await cdp('Page.reload');
  await ready();
  // A saved route beside B02 previously restored its label inside that node.
  const labelEdgeId = '3458764686135623292';
  const labelRoute = [{ x: 2944, y: 2020 }, { x: 2932, y: 2020 }, { x: 2932, y: 1940 }, { x: 2908, y: 1940 }, { x: 2908, y: 2777 }, { x: 2944, y: 2777 }];
  await evaluate('localStorage.setItem("frame12-layout-v1",' + JSON.stringify(JSON.stringify({ version: 1, nodes: {}, edges: { [labelEdgeId]: labelRoute } })) + ')');
  await cdp('Page.reload');
  await ready();
  check('A valid saved connector beside B02 restores its manual route', JSON.stringify(await pathPoints(labelEdgeId)) === JSON.stringify(labelRoute));
  check('Restored manual connector label avoids all nodes', await evaluate('(() => {const label=document.querySelector(".graph-edge[data-id=\\"' + labelEdgeId + '\\"] .edge-label").getBBox(),a={x:label.x-3.5,y:label.y-3.5,width:label.width+7,height:label.height+7};return [...document.querySelectorAll(".node-shape")].every(shape=>{const b=shape.getBBox();return !(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)})})()'));
  await evaluate('localStorage.removeItem("frame12-layout-v1")');
  await cdp('Page.reload');
  await ready();
  await focusNode();
  const original = await nodePosition();
  const originalPoints = await pathPoints();
  const grid = await evaluate('(() => {const svg=document.getElementById("diagram"),p=document.getElementById("frame12-dot-grid"),step=Number(svg.dataset.gridStep);return {step,width:Number(p.getAttribute("width")),height:Number(p.getAttribute("height")),spacing:step*svg.getScreenCTM().a}})()');
  check('Dense SVG grid matches displayed snap interval', grid.step === grid.width && grid.step === grid.height && grid.step >= 5 && grid.spacing >= 7.99 && (grid.spacing <= 16.01 || grid.step === 5));
  await editMode();
  check('Undo and redo start disabled', await evaluate('document.getElementById("layout-undo").disabled && document.getElementById("layout-redo").disabled'));
  const target = { x: original.x + original.step * 2.37, y: original.y + original.step * .61 };
  const expected = { x: Math.round(target.x / original.step) * original.step, y: Math.round(target.y / original.step) * original.step };
  const endpoint = await screenPoint(target);
  await drag(original.screen, endpoint);
  await saved();
  const moved = await nodePosition(), savedNode = (await storage())?.nodes?.[nodeId];
  check('Node drag snaps its center to visible grid', positionEquals(moved, expected));
  check('Node source geometry is unchanged', JSON.stringify(moved.source) === JSON.stringify(original.source));
  check('Display-only node layout is persisted', !!savedNode && Number.isFinite(savedNode.x) && Number.isFinite(savedNode.y));
  check('Node drag does not open the information inspector', await evaluate('document.getElementById("inspector").hidden'));
  check('All rerouted connectors stay attached to their original endpoint nodes', await attachedEndpoints());
  await click('layout-undo');
  await until('document.getElementById("layout-redo").disabled === false', 'node undo');
  check('Undo restores original node position', positionEquals(await nodePosition(), original));
  await click('layout-redo');
  await saved();
  check('Redo restores snapped node position', positionEquals(await nodePosition(), moved));
  await key('z', 'KeyZ', 2);
  await until('document.getElementById("layout-redo").disabled === false', 'keyboard undo');
  check('Ctrl+Z undoes the node move', positionEquals(await nodePosition(), original));
  await key('Z', 'KeyZ', 10);
  await saved();
  check('Ctrl+Shift+Z redoes the node move', positionEquals(await nodePosition(), moved));
  await cdp('Page.reload');
  await ready();
  check('Node layout survives reload', positionEquals(await nodePosition(), moved));
  await focusNode();
  await editMode();
  const beforeNudge = await nodePosition();
  await evaluate('document.querySelector(' + JSON.stringify(selector(nodeId)) + ').focus({preventScroll:true})');
  await key('ArrowRight', 'ArrowRight');
  await saved();
  check('Arrow keys move a focused node by one grid step', positionEquals(await nodePosition(), { x: beforeNudge.x + beforeNudge.step, y: beforeNudge.y }));
  await key('z', 'KeyZ', 2);
  await saved();
  check('Keyboard nudges can be undone', positionEquals(await nodePosition(), beforeNudge));

  // Cancelling a real in-progress mouse drag must leave both display and storage intact.
  const beforeCancel = await nodePosition(), beforeCancelStorage = JSON.stringify(await storage());
  const cancelTarget = await screenPoint({ x: beforeCancel.x + beforeCancel.step * 3, y: beforeCancel.y });
  await drag(beforeCancel.screen, cancelTarget, false);
  await key('Escape', 'Escape');
  await release(cancelTarget);
  await delay(200);
  check('Escape cancels an unfinished node move', positionEquals(await nodePosition(), beforeCancel) && JSON.stringify(await storage()) === beforeCancelStorage);
  await editMode();
  const beforePointerCancel = await nodePosition();
  await drag(beforePointerCancel.screen, cancelTarget, false);
  await evaluate('document.getElementById("diagram").dispatchEvent(new PointerEvent("pointercancel",{pointerId:1,bubbles:true}))');
  await release(cancelTarget);
  await delay(200);
  check('Pointer cancellation rolls back the preview', positionEquals(await nodePosition(), beforePointerCancel) && JSON.stringify(await storage()) === beforeCancelStorage);

  await evaluate('document.querySelector("[data-region=land]").click()');
  await delay(180);
  const beforeCollision = await nodePosition(), obstacle = await nodePosition(nextNodeId);
  await drag(beforeCollision.screen, obstacle.screen);
  await delay(600);
  check('Dropping a node onto another node rolls back', positionEquals(await nodePosition(), beforeCollision) && JSON.stringify(await storage()) === beforeCancelStorage);

  // Reset before testing a direct first/last segment; its fixed endpoint stubs need doglegs.
  await click('layout-reset');
  await until('document.getElementById("layout-undo").disabled === false', 'reset layout');
  check('Reset restores original node position', positionEquals(await nodePosition(), original));
  await editMode(false);
  await focusNode();
  await editMode();
  await evaluate('document.querySelector(".graph-edge[data-id=\\"' + edgeId + '\\"]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
  await until('document.querySelector(".edge-handle[data-edge-id=\\"' + edgeId + '\\"]") !== null', 'line handles');
  const handle = await evaluate('(() => {const h=document.querySelector(".edge-handle[data-edge-id=\\"' + edgeId + '\\"]"),p=new DOMPoint(Number(h.getAttribute("cx")),Number(h.getAttribute("cy"))).matrixTransform(h.getScreenCTM());return{x:Number(h.getAttribute("cx")),y:Number(h.getAttribute("cy")),screen:{x:p.x,y:p.y},index:Number(h.dataset.segmentIndex),step:Number(document.getElementById("diagram").dataset.gridStep)}})()');
  const edgeBefore = await pathPoints();
  const a = edgeBefore[handle.index], b = edgeBefore[handle.index + 1];
  const axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'y' : 'x';
  const routeTarget = { x: handle.x, y: handle.y, [axis]: handle[axis] + handle.step * 2.37 };
  const lane = Math.round(routeTarget[axis] / handle.step) * handle.step;
  await drag(handle.screen, await screenPoint(routeTarget));
  await saved();
  const edgeMoved = await pathPoints(), manual = (await storage())?.edges?.[edgeId];
  check('Connector handle changes and saves the route', JSON.stringify(edgeMoved) !== JSON.stringify(edgeBefore) && Array.isArray(manual) && manual.length >= 4);
  check('Connector segment snaps to a grid lane', edgeMoved.slice(1).some((p, i) => close(p[axis], lane) && close(edgeMoved[i][axis], lane)));
  check('Moving an endpoint segment keeps its endpoints fixed', positionEquals(edgeMoved[0], edgeBefore[0]) && positionEquals(edgeMoved.at(-1), edgeBefore.at(-1)));
  check('Edited connector consists of orthogonal segments', edgeMoved.slice(1).every((p, i) => close(p.x, edgeMoved[i].x) || close(p.y, edgeMoved[i].y)));
  check('All connectors remain attached after line editing', await attachedEndpoints());
  await screenshot('layout-edit-desktop');
  await click('layout-undo');
  await until('document.getElementById("layout-redo").disabled === false', 'connector undo');
  check('Undo restores connector route', JSON.stringify(await pathPoints()) === JSON.stringify(edgeBefore));
  await click('layout-redo');
  await saved();
  check('Redo restores connector route', JSON.stringify(await pathPoints()) === JSON.stringify(edgeMoved));
  await cdp('Page.reload');
  await ready();
  check('Edited connector survives reload', JSON.stringify(await pathPoints()) === JSON.stringify(edgeMoved));
  await editMode();
  await click('layout-reset');
  await delay(300);
  check('Reset restores the original route and clears manual overrides', JSON.stringify(await pathPoints()) === JSON.stringify(originalPoints) && !Object.keys((await storage())?.nodes || {}).length && !Object.keys((await storage())?.edges || {}).length);
  await editMode(false);
  await focusNode();
  await editMode();
  const direct = await evaluate('(() => {const p=document.querySelector(".graph-edge[data-id=\\"' + edgeId + '\\"] .edge-line"),m=p.getPointAtLength(p.getTotalLength()/2);return{x:m.x,y:m.y,step:Number(document.getElementById("diagram").dataset.gridStep)}})()');
  await drag(await screenPoint(direct), await screenPoint({ x: direct.x + direct.step * 2.37, y: direct.y }));
  await saved();
  check('An unselected connector can be dragged directly without first choosing a handle', !!(await storage())?.edges?.[edgeId] && await evaluate('document.querySelectorAll(".edge-handle").length > 0 && document.getElementById("inspector").hidden'));
  await click('layout-reset');
  await editMode(false);
  await focusNode();
  const clickPoint = (await nodePosition()).screen;
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...clickPoint, button: 'left', buttons: 1, clickCount: 1 });
  await release(clickPoint);
  await delay(100);
  check('Normal click opens source information and a circular, non-interactive node ripple', await evaluate(`(()=>{
    const selected=document.querySelector('.graph-node.is-selected');
    const ripple=selected?.querySelector('.node-click-ripple');
    const rings=[...(selected?.querySelectorAll('.node-click-ripple-ring')||[])];
    return !document.getElementById('inspector').hidden&&selected?.dataset.id===${JSON.stringify(nodeId)}
      &&!!ripple&&ripple.dataset.nodeId===${JSON.stringify(nodeId)}
      &&getComputedStyle(ripple).pointerEvents==='none'&&rings.length===2
      &&rings.every(ring=>ring.localName==='circle'&&Number(ring.getAttribute('r'))>0
        &&Math.abs(ring.getBoundingClientRect().width-ring.getBoundingClientRect().height)<.5)
      &&rings.some(ring=>Number(getComputedStyle(ring).opacity)>0);
  })()`));
  await click('close-inspector');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await focusNode();
  await editMode();
  await delay(200);
  const mobileBefore = await nodePosition();
  const mobileTarget = { x: mobileBefore.x + mobileBefore.step * 2.37, y: mobileBefore.y + mobileBefore.step * .61 };
  await touchDrag(mobileBefore.screen, await screenPoint(mobileTarget));
  await saved();
  const mobileMoved = await nodePosition();
  check('Mobile touch drag snaps to the visible grid', positionEquals(mobileMoved, { x: Math.round(mobileTarget.x / mobileBefore.step) * mobileBefore.step, y: Math.round(mobileTarget.y / mobileBefore.step) * mobileBefore.step }));
  check('Mobile editing has no horizontal page overflow', await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  check('Mobile edit controls remain visible', await evaluate('["edit-layout","layout-undo","layout-redo","layout-reset"].every(id=>{const b=document.getElementById(id).getBoundingClientRect();return b.width>0&&b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight})'));
  await screenshot('layout-edit-mobile');
  await click('layout-reset');
  check('Mobile reset restores the source layout', positionEquals(await nodePosition(), original));
  check('No browser runtime errors', errors.length === 0);
  await mkdir('.preview', { recursive: true });
  await writeFile('.preview/layout-browser-report.json', JSON.stringify({ status: 'passed', checks, grid, moved: { x: moved.x, y: moved.y }, editedRoute: edgeMoved, runtimeErrors: errors }, null, 2));
  console.log(JSON.stringify({ status: 'passed', checks, runtimeErrors: errors.length }));
} finally {
  if (originalStorage) {
    await evaluate('(() => {const previous=' + JSON.stringify(originalStorage) + ';for(const [key,value] of [["frame12-layout-v1",previous.layout],["frame12-theme",previous.theme]]){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}})()').catch(() => {});
  }
  socket.close();
  await fetch(debug + '/json/close/' + page.id).catch(() => {});
}
