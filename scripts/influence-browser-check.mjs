// Focused integration checks. Requires the preview server and Chromium CDP on 9224.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.SITE_URL || 'http://127.0.0.1:4173/';
const debug = `http://127.0.0.1:${process.env.EDGE_DEBUG_PORT || 9224}`;
const tab = await (await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map(), errors = [], checks = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject, timeout: setTimeout(() => {
      pending.delete(id); reject(new Error(`Timed out: ${method}`));
    }, 15000) });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let index = 0; index < 100; index++) {
    try {
      if (await evaluate(expression)) return;
    } catch (error) {
      if (!/context.*destroyed|Cannot find context/i.test(error.message)) throw error;
    }
    await pause(100);
  }
  throw new Error(`Condition not reached: ${expression}`);
}
async function check(name, expression) {
  assert.equal(await evaluate(expression), true, name);
  checks.push(name);
}
async function screenshot(name) {
  await evaluate('document.fonts.ready');
  await pause(180);
  const result = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(`.preview/${name}.png`, Buffer.from(result.data, 'base64'));
}
let previousTheme;
try {
  await mkdir('.preview', { recursive: true });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await waitFor('document.querySelectorAll(".graph-node").length === 128 && document.getElementById("loading-state").hidden');
  previousTheme = await evaluate('localStorage.getItem("frame12-theme")');
  await evaluate('document.getElementById("theme-paper").click(); document.getElementById("influence-button").click()');
  await waitFor('document.getElementById("influence-panel")?.dataset.loaded === "true"');
  await check('All 31 annotated nodes and three separate pathways render', 'document.querySelectorAll(".influence-node-list .influence-node-card").length === 31 && document.querySelectorAll(".influence-supplementary-card").length === 3');
  await check('Five mechanism counts retain source order', 'JSON.stringify([...document.querySelectorAll(".influence-mechanism-count")].map(n=>+n.textContent)) === "[20,1,3,1,6]"');
  await check('Analysis has its own navigation state and hides diagram controls', 'location.hash === "#view=influence" && document.getElementById("influence-button").getAttribute("aria-current") === "true" && document.getElementById("diagram-wrap").hidden && document.getElementById("spider-dock").hidden && document.querySelector(".map-controls").hidden');
  await screenshot('influence-overview');
  await evaluate('document.querySelector(".influence-mechanism[data-mechanism=formal]").click()');
  await check('Formal participation stays distinct and expandable', 'document.querySelectorAll(".influence-node-list .influence-node-card").length === 1 && document.querySelector(".influence-participation-tiers").querySelectorAll("li").length === 3');
  await evaluate('document.querySelector(".influence-node-list [data-code=G17]").click()');
  await check('G17 detail retains access, authority and official evidence', 'document.getElementById("inspector-content").textContent.includes("enhanced status requires application/admission") && document.getElementById("inspector-content").textContent.includes("Who Decides?") && !!document.querySelector("#inspector-content a[href*=file-a-petition-to-intervene]")');
  await screenshot('influence-detail');
  await cdp('Page.reload');
  await waitFor('document.getElementById("influence-panel")?.dataset.loaded === "true" && !document.getElementById("inspector").hidden');
  await check('Selected record survives reload under the same base path', 'location.pathname === new URL(' + JSON.stringify(base) + ').pathname && location.hash.includes("entry=G17") && document.querySelector("#inspector-content h1").textContent.includes("DPU")');
  await evaluate('document.getElementById("close-inspector").click(); document.querySelector(".influence-domain[data-domain=\\"Environmental Review\\"]").click()');
  await check('Context filter returns nine environmental nodes', 'document.querySelectorAll(".influence-node-list .influence-node-card").length === 9');
  await evaluate('const search=document.getElementById("influence-search-input"); search.value="ENF"; search.dispatchEvent(new Event("input"))');
  await check('Search combines with context filtering', 'document.querySelectorAll(".influence-node-list .influence-node-card").length === 1 && document.querySelector(".influence-node-list .influence-node-card").dataset.code === "EM04"');
  await evaluate('document.getElementById("influence-search-input").value="no-such-pathway"; document.getElementById("influence-search-input").dispatchEvent(new Event("input"))');
  await check('No-results state is recoverable', '!document.querySelector(".influence-empty").hidden');
  await evaluate('document.querySelector(".influence-empty-reset").click(); document.querySelector(".influence-supplementary-list [data-code=EA08]").click()');
  await check('Supplementary EA08 selects separately from its annotated record', 'location.hash.includes("path=supplementary") && document.querySelectorAll(".influence-node-card.is-selected").length === 1 && !!document.querySelector(".influence-supplementary-list [data-code=EA08].is-selected") && document.querySelector("#inspector-content h1").textContent === "Title V EPA Objection Petition"');
  await cdp('Page.reload');
  await waitFor('document.getElementById("influence-panel")?.dataset.loaded === "true" && !document.getElementById("inspector").hidden');
  await check('Supplementary deep link survives reload', 'document.querySelector("#inspector-content h1").textContent === "Title V EPA Objection Petition"');
  await evaluate('document.querySelector("#inspector-content .endpoint-link").click()');
  await waitFor('document.getElementById("main").dataset.view === "diagram" && !!document.querySelector(".graph-node.is-selected")');
  await check('Analysis opens the original graph node and restores controls', 'document.querySelector("#inspector-content h1").textContent.includes("EA08") && !document.getElementById("spider-dock").hidden && !document.querySelector(".map-controls").hidden');
  await evaluate('document.getElementById("close-inspector").click(); document.getElementById("overview-discover").click()');
  await waitFor('document.getElementById("main").dataset.view === "landscape" && !document.getElementById("main").classList.contains("is-untangling")');
  await check('Animated Explore to Discover remains available', 'document.querySelectorAll(".landscape-node").length === 128');
  await evaluate('document.getElementById("influence-button").click(); document.getElementById("theme-night").click(); document.getElementById("influence-panel").scrollTop=0');
  await screenshot('influence-night');
  await check('Dark theme uses existing tokens', 'document.documentElement.dataset.theme === "night" && getComputedStyle(document.getElementById("influence-panel")).backgroundColor === "rgb(17, 17, 19)"');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('document.getElementById("theme-paper").click(); document.getElementById("influence-button").scrollIntoView({block:"nearest",inline:"nearest"}); document.getElementById("influence-panel").scrollTop=0');
  await pause(150);
  await check('Mobile analysis fits the viewport', 'document.documentElement.scrollWidth <= innerWidth && document.getElementById("influence-panel").scrollWidth <= document.getElementById("influence-panel").clientWidth + 1 && document.getElementById("influence-button").getBoundingClientRect().right <= innerWidth + 1');
  await screenshot('influence-mobile');
  await evaluate('document.querySelector(".influence-node-list [data-code=EM04]").click()');
  await check('Mobile detail sheet is reachable and contains original questions', '!document.getElementById("inspector").hidden && document.querySelector("#inspector-content").textContent.includes("When can I influence?") && document.getElementById("close-inspector").getBoundingClientRect().right <= innerWidth');
  await evaluate('document.getElementById("close-inspector").click(); document.querySelector(".skip-link").click()');
  await check('Skip link keeps analysis routing intact', 'location.hash === "#view=influence" && document.activeElement.id === "influence-panel"');
  assert.deepEqual(errors, [], 'No JavaScript runtime errors');
  await writeFile('.preview/influence-report.json', JSON.stringify({ base, checks, runtimeErrors: errors }, null, 2));
  console.log(`Public Influence browser checks passed: ${checks.length}; no runtime errors.`);
} finally {
  if (previousTheme !== undefined) {
    await evaluate(previousTheme === null ? 'localStorage.removeItem("frame12-theme")' : `localStorage.setItem("frame12-theme",${JSON.stringify(previousTheme)})`).catch(() => {});
  }
  socket.close();
  await pause(100);
  await fetch(`${debug}/json/close/${tab.id}`).catch(() => {});
}
