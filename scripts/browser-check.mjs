// Browser integration checks through a local Edge/Chromium DevTools session.
// Start a headless browser on port 9224 and npm start before running this file.
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4173';
const debug = `http://127.0.0.1:${process.env.EDGE_DEBUG_PORT || 9224}`;
const page = await (await fetch(`${debug}/json/new?${encodeURIComponent(base)}`,{method:'PUT'})).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let nextId=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p?.reject(new Error(msg.error.message)):p?.resolve(msg.result);}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails);});
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+r.exceptionDetails.exception?.description);return r.result.value;}
async function ready(){for(let i=0;i<80;i++){if(await evaluate('document.querySelectorAll(".graph-node").length === 128 && document.getElementById("loading-state").hidden'))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Diagram did not load');}
async function screenshot(name){await evaluate('document.fonts.ready');await new Promise(r=>setTimeout(r,150));const image=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(`.preview/${name}.png`,Buffer.from(image.data,'base64'));}
await mkdir('.preview',{recursive:true});
try{
  await cdp('Page.enable');await cdp('Runtime.enable');
  // A CDP-created background tab can defer CSS transitions until their first read.
  await cdp('Page.bringToFront');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:base});await ready();
  await evaluate('document.getElementById("theme-paper").click()');
  await evaluate('document.fonts.ready');
  const report=await evaluate(`(async()=>{
    const data=await(await fetch('data/frame12.json')).json();
    const checks=[], failures=[];
    const check=(name,pass)=>{checks.push({name,passed:!!pass});if(!pass)failures.push(name);};
    check('128 rendered nodes',document.querySelectorAll('.graph-node').length===128);
    check('181 rendered directed connections',document.querySelectorAll('.graph-edge').length===181&&document.querySelectorAll('.edge-line[marker-end]').length===181);
    check('105 exact connector labels',data.connections.filter(c=>c.label_text).every(c=>document.querySelector('.graph-edge[data-id="'+c.connection_id+'"] .edge-label').textContent===c.label_text));
    check('6 retained backgrounds and 7 source headings',document.querySelectorAll('.graph-background').length===6&&document.querySelectorAll('.graph-note').length===7&&data.canvasItems.filter(n=>n.role==='standalone_label'&&n.display_location==='canvas').every(n=>document.querySelector('.graph-note[data-id="'+n.item_id+'"]')));
    check('3 rotated labels',document.querySelectorAll('.graph-note[transform]').length===3);
    check('All node IDs, positions and source colors',data.nodes.every(n=>{const s=document.querySelector('.graph-node[data-id="'+n.node_id+'"] .node-shape');return s&&s.getAttribute('fill')===n.fill_color&&(n.shape==='rhombus'||Number(s.getAttribute('x'))===n.layout.x&&Number(s.getAttribute('y'))===n.layout.y&&Number(s.getAttribute('width'))===n.layout.width&&Number(s.getAttribute('height'))===n.layout.height);}));
    check('Uniform Helvetica: 22px nodes and 18px connector labels',[...document.querySelectorAll('.graph-node .graph-rich-text')].every(n=>getComputedStyle(n).fontSize==='22px'&&getComputedStyle(n).fontFamily.includes('Helvetica'))&&[...document.querySelectorAll('.edge-label')].every(n=>getComputedStyle(n).fontSize==='18px'&&getComputedStyle(n).fontFamily.includes('Helvetica')));
    check('All node labels fit their original boxes',[...document.querySelectorAll('.graph-node .graph-rich-text')].every(n=>n.firstElementChild.scrollHeight<=n.clientHeight+1&&n.firstElementChild.scrollWidth<=n.clientWidth+1));
    const bounds=(element,padding=0)=>{const b=element.getBBox();return {x:b.x-padding,y:b.y-padding,width:b.width+padding*2,height:b.height+padding*2};};
    const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    const nodeBoxes=[...document.querySelectorAll('.node-shape')].map(n=>bounds(n));
    const labelBoxes=[...document.querySelectorAll('.edge-label')].map(n=>bounds(n,3.5));
    check('Connector text and halos avoid nodes and other labels',labelBoxes.every((label,i)=>nodeBoxes.every(node=>!intersects(label,node))&&labelBoxes.slice(i+1).every(other=>!intersects(label,other))));
    const normalize=s=>s.replace(/\\s+/g,' ').trim();
    const bodyText=html=>new DOMParser().parseFromString(html,'text/html').body.textContent;
    const sourceShapeMatches=(node,shape)=>!!shape&&(shape.localName==='path'?shape.dataset.sourceShape===node.shape&&(shape.getAttribute('d')||'').trim().toLowerCase().endsWith('z'):node.shape==='rhombus'?shape.localName==='polygon'&&shape.points.numberOfItems===4:shape.localName==='rect'&&(node.shape==='round_rectangle'?Number(shape.getAttribute('rx'))>0:Number(shape.getAttribute('rx')||0)===0));
    for(const node of data.nodes){
      document.querySelector('.graph-node[data-id="'+node.node_id+'"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      const glow=document.querySelector('.glow-node.is-primary .glow-bloom');
      if(!sourceShapeMatches(node,glow))failures.push('Selected glow shape mismatch '+node.node_id);
      const shown=[...document.querySelectorAll('.source-block')];
      const wanted=['Description','Evidence','Time Scope','Public Influence'].flatMap(k=>node.sections[k]||[]);
      if(shown.length!==wanted.length||shown.some((s,i)=>s.dataset.blockId!==wanted[i].block_id||normalize(s.textContent)!==normalize(bodyText(wanted[i].render_html))))failures.push('Sidebar content mismatch '+node.node_id);
      const links=[...document.querySelectorAll('.source-block a')].map(a=>[a.getAttribute('href'),a.textContent]);
      if(links.length!==node.evidence_links.length||links.some((l,i)=>l[0]!==node.evidence_links[i].url||l[1]!==bodyText(node.evidence_links[i].source_link_html)))failures.push('Evidence link mismatch '+node.node_id);
    }
    check('128 sidebars preserve all 639 blocks and exact link ownership',!failures.some(f=>/Sidebar|Evidence link/.test(f)));
    check('All 128 selected glows preserve the original node shape type',!failures.some(f=>f.startsWith('Selected glow shape mismatch')));
    const colors=[...document.querySelectorAll('.source-block [style]')].filter(s=>s.style.color).length;
    for(const edge of data.connections){
      document.querySelector('.graph-edge[data-id="'+edge.connection_id+'"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      const ids=[...document.querySelectorAll('.endpoint-link')].map(b=>b.dataset.nodeId);
      if(ids[0]!==edge.start_node_id||ids[1]!==edge.end_node_id)failures.push('Connection mismatch '+edge.connection_id);
    }
    check('All 181 connection inspectors preserve direction',!failures.some(f=>f.startsWith('Connection mismatch')));
    document.getElementById('close-inspector').click();document.getElementById('fit-button').click();
    return {checks,failures};
  })()`);
  assert.deepEqual(report.failures,[],'Content integration failures');
  await new Promise(r=>setTimeout(r,120));
  await screenshot('overview');
  const interaction = await evaluate(`(async()=>{
    const check={};const q=id=>document.getElementById(id);
    q('index-button').click();q('search-input').value='L01';q('search-input').dispatchEvent(new Event('input'));
    check.search=q('search-results').querySelectorAll('.result-button').length===1;
    q('search-results').querySelector('.result-button').click();await new Promise(requestAnimationFrame);
    check.selected=q('inspector').hidden===false&&q('inspector-content').textContent.includes('Locate the BOSTON parcel');
    const firstRing=document.querySelector('.focus-ring');
    check.ripple=document.querySelectorAll('.focus-ring.is-rippling').length===2&&getComputedStyle(firstRing).animationName==='node-ripple';
    document.querySelector('.graph-node.is-selected').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    check.rippleReplays=firstRing!==document.querySelector('.focus-ring');
    check.section=q('inspector-content').querySelector('h2').textContent==='Description';
    const before=q('diagram').getAttribute('viewBox');q('zoom-in').click();check.zoom=before!==q('diagram').getAttribute('viewBox');
    q('labels-toggle').click();check.labelsHidden=[...document.querySelectorAll('.edge-label')].every(l=>l.style.display==='none');q('labels-toggle').click();
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check.escape=q('inspector').hidden;
    q('index-button').click();q('connections-tab').click();q('search-input').value='Begin local';q('search-input').dispatchEvent(new Event('input'));check.edgeSearch=q('search-results').querySelectorAll('.result-button').length===1;
    q('search-results').querySelector('.result-button').click();check.edgeSelected=q('inspector-content').querySelectorAll('.endpoint-link').length===2;
    q('close-inspector').click();q('source-button').click();check.dialog=q('source-dialog').open;q('close-source').click();
    q('index-button').click();q('nodes-tab').click();q('search-input').value='L04';q('search-input').dispatchEvent(new Event('input'));q('search-results').querySelector('.result-button').click();await new Promise(requestAnimationFrame);
    return check;
  })()`);
  assert(Object.values(interaction).every(Boolean),JSON.stringify(interaction));
  const svgBeforePan=await evaluate('document.getElementById("diagram").getAttribute("viewBox")');
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:900,y:700,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:820,y:660,button:'left',buttons:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:820,y:660,button:'left',clickCount:1});
  interaction.pointerPan=svgBeforePan!==await evaluate('document.getElementById("diagram").getAttribute("viewBox")');
  const svgBeforeWheel=await evaluate('document.getElementById("diagram").getAttribute("viewBox")');
  await cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:650,y:500,deltaY:-130,deltaX:0});
  await new Promise(r=>setTimeout(r,100));
  interaction.wheelZoom=svgBeforeWheel!==await evaluate('document.getElementById("diagram").getAttribute("viewBox")');
  const hit=await evaluate(`(()=>{const r=document.querySelector('.graph-node[data-id="3458764686135623239"] .node-shape').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...hit,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...hit,button:'left',clickCount:1});
  interaction.pointerSelect=await evaluate('!document.getElementById("inspector").hidden && document.querySelector(".graph-node.is-selected").dataset.id === "3458764686135623239"');
  assert(Object.values(interaction).every(Boolean),JSON.stringify(interaction));
  await screenshot('node-details');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('new Promise(requestAnimationFrame)');
  const mobile = await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,inspectorVisible:!document.getElementById('inspector').hidden,inside:document.getElementById('inspector').getBoundingClientRect().right<=innerWidth,nodeAbovePanel:document.querySelector('.graph-node.is-selected .node-shape').getBoundingClientRect().bottom<document.getElementById('inspector').getBoundingClientRect().top})`);
  assert.equal(mobile.overflow,false);assert(mobile.inspectorVisible&&mobile.inside);
  assert(mobile.nodeAbovePanel,'Selected mobile node must remain above the bottom panel');
  await screenshot('mobile');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.getElementById('close-inspector').click();document.querySelector('[data-region="land"]').click();new Promise(requestAnimationFrame)`);
  await screenshot('land-use');
  // Theme changes must not mutate the diagram's content, state or ownership.
  await evaluate(`document.querySelector('.graph-node[data-id="3458764686135623239"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));new Promise(requestAnimationFrame)`);
  const theme = await evaluate(`(async()=>{
    const data=await(await fetch('data/frame12.json')).json();
    const q=id=>document.getElementById(id), out={};
    const snapshot=()=>JSON.stringify({hash:location.hash,view:q('diagram').getAttribute('viewBox'),note:q('inspector-content').textContent,ids:[...document.querySelectorAll('.graph-node')].map(n=>n.dataset.id)});
    const before=snapshot();q('theme-night').click();
    out.nightSelected=document.documentElement.dataset.theme==='night'&&q('theme-night').getAttribute('aria-pressed')==='true';
    out.statePreserved=before===snapshot();
    out.sourceAttributes=data.nodes.every(n=>document.querySelector('.graph-node[data-id="'+n.node_id+'"] .node-shape').getAttribute('fill')===n.fill_color)&&data.connections.every(e=>document.querySelector('.graph-edge[data-id="'+e.connection_id+'"] .edge-line').getAttribute('stroke')===e.line_color);
    out.operationStagePanels=[...document.querySelectorAll('.graph-panel-stage')].length===3&&[...document.querySelectorAll('.graph-panel-stage')].every(n=>n.parentElement.dataset.section==='operation'&&n.getAttribute('fill')==='#fff6b6');
    const sectionCounts={land:30,grid:29,environment:52,operation:9};
    out.sectionMembership=Object.entries(sectionCounts).every(([key,count])=>document.querySelectorAll('.graph-node[data-section="'+key+'"]').length===count)&&document.querySelectorAll('.graph-node:not([data-section])').length===8;
    out.operationGridNodes=data.nodes.filter(n=>['G26','G27','G28'].includes(n.display_code)).every(n=>document.querySelector('.graph-node[data-id="'+n.node_id+'"]').dataset.section==='operation');
    // Respect the existing app-level omission of these two Grid notes, retaining the source records.
    out.existingGridNoteOmission=['3458764686136016363','3458764686136016376'].every(id=>data.canvasItems.some(n=>n.item_id===id)&&!document.querySelector('.graph-note[data-id="'+id+'"]'));
    out.themeReadingPane=getComputedStyle(q('inspector')).backgroundColor==='rgb(36, 36, 38)';
    const colorChannels=color=>{const value=color.trim(),hex=value.match(/^#([a-f0-9]{6}|[a-f0-9]{3})$/i);if(hex){const full=hex[1].length===3?[...hex[1]].map(n=>n+n).join(''):hex[1];return [0,2,4].map(i=>parseInt(full.slice(i,i+2),16));}return value.match(/[0-9.]+/g).slice(0,3).map(Number);};
    const sameColor=(a,b)=>JSON.stringify(colorChannels(a))===JSON.stringify(colorChannels(b));
    const luminance=color=>{const channels=colorChannels(color).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const palette={paper:{fills:['rgb(248, 250, 255)','rgb(231, 234, 255)'],border:'rgb(116, 131, 184)',edge:'rgb(86, 103, 141)',active:'rgb(9, 106, 131)'},night:{fills:['rgb(26, 34, 67)','rgb(48, 52, 100)'],border:'rgb(125, 143, 201)',edge:'rgb(169, 183, 224)',active:'rgb(88, 221, 243)'}};
    out.paletteContrast=true;out.restrainedGraphPalette=true;out.selectedArrowMatches=true;out.hairlineStrokes=true;out.sectionColorsDistinct=true;out.sectionPaletteConsistent=true;out.edgeSectionOwnership=true;out.edgeSectionPaletteConsistent=true;out.backgroundsHidden=true;out.nodeAuras=true;
    for(const mode of ['paper','night']){
      q('theme-'+mode).click();
      // Start the navigation color transition before the settling delay, even in a hidden tab.
      void getComputedStyle(document.querySelector('.rail-item[data-section="land"]')).color;
      await new Promise(resolve=>setTimeout(resolve,180));
      const node=document.querySelector('.graph-node.is-selected');
      const core=getComputedStyle(q('diagram')).getPropertyValue('--glow-core');
      const canvas=getComputedStyle(q('diagram-wrap')).backgroundColor;
      const ink=getComputedStyle(node.querySelector('.graph-rich-text')).color;
      const panel=getComputedStyle(q('inspector')).backgroundColor;
      const text=getComputedStyle(q('inspector').querySelector('.detail-section p')).color;
      const link=getComputedStyle(q('inspector').querySelector('.detail-section a')).color;
      const meta=getComputedStyle(q('inspector').querySelector('.item-id')).color;
      // Text sits over the aura's quiet center; test both center and canvas colors.
      out.paletteContrast&&=Math.min(contrast(core,ink),contrast(canvas,ink))>=4.5&&contrast(panel,text)>=4.5&&contrast(panel,link)>=4.5&&contrast(panel,meta)>=4.5;
      out.restrainedGraphPalette&&=[...document.querySelectorAll('.graph-edge:not([data-section]):not(.is-selected) .edge-line')].every(s=>getComputedStyle(s).stroke===palette[mode].edge);
      out.nodeAuras&&=document.querySelectorAll('.graph-node-auras > .node-aura').length===128&&[...document.querySelectorAll('.graph-node')].every(n=>{const a=document.querySelector('.node-aura[data-aura-id="'+n.dataset.id+'"]');return a&&a.dataset.section===n.dataset.section;});
      const colors=[];
      for(const key of Object.keys(sectionCounts)){
        const nav=document.querySelector('.rail-item[data-section="'+key+'"]'),color=getComputedStyle(nav).color;
        colors.push(color);
        out.sectionPaletteConsistent&&=[...document.querySelectorAll('.node-aura[data-section="'+key+'"]')].every(s=>sameColor(getComputedStyle(s).getPropertyValue('--section-color'),color))&&[...document.querySelectorAll('.graph-note[data-section="'+key+'"] .graph-rich-text')].every(t=>getComputedStyle(t).color===color);
        out.paletteContrast&&=contrast(color,getComputedStyle(document.querySelector('.rail')).backgroundColor)>=4.5;
      }
      out.sectionColorsDistinct&&=new Set(colors).size===4;
      for(const edge of data.connections){
        const group=document.querySelector('.graph-edge[data-id="'+edge.connection_id+'"]');
        const section=document.querySelector('.graph-node[data-id="'+edge.start_node_id+'"]').dataset.section||document.querySelector('.graph-node[data-id="'+edge.end_node_id+'"]').dataset.section;
        out.edgeSectionOwnership&&=group.dataset.section===section;
        const line=group.querySelector('.edge-line'),label=group.querySelector('.edge-label');
        const markerId=getComputedStyle(line).markerEnd.match(/#([^"\\)]+)/)?.[1],marker=document.getElementById(markerId);
        const expected=section?getComputedStyle(document.querySelector('.rail-item[data-section="'+section+'"]')).color:palette[mode][group.classList.contains('is-selected')?'active':'edge'];
        out.edgeSectionPaletteConsistent&&=getComputedStyle(line).stroke===expected&&!!marker&&marker.dataset.section===section&&getComputedStyle(marker.querySelector('path')).fill===expected&&(!section||!label||getComputedStyle(label).fill===expected);
      }
      out.backgroundsHidden&&=[...document.querySelectorAll('.graph-background,.graph-frame')].every(n=>getComputedStyle(n).display==='none');
      out.paletteContrast&&=[...document.querySelectorAll('.graph-node')].every(n=>{const text=getComputedStyle(n.querySelector('.graph-rich-text')).color;return Math.min(contrast(core,text),contrast(canvas,text))>=4.5;});
      out.sectionPaletteConsistent&&=sameColor(getComputedStyle(q('inspector').querySelector('.eyebrow')).color,getComputedStyle(node).getPropertyValue('--section-color'));
      const hairlines=()=>[...document.querySelectorAll('.node-shape')].every(s=>getComputedStyle(s).vectorEffect==='non-scaling-stroke'&&Number.parseFloat(getComputedStyle(s).strokeWidth)<=.7)&&Number.parseFloat(getComputedStyle(node.querySelector('.node-outline')).strokeWidth)<=.9;
      const viewBefore=q('diagram').getAttribute('viewBox');
      out.hairlineStrokes&&=hairlines();for(let i=0;i<3;i++)q('zoom-in').click();
      out.hairlineStrokes&&=hairlines()&&viewBefore!==q('diagram').getAttribute('viewBox');
      for(let i=0;i<3;i++)q('zoom-out').click();
      const line=document.querySelector('.graph-edge.is-selected .edge-line');
      const markerId=getComputedStyle(line).markerEnd.match(/#([^"\\)]+)/)[1];
      const selectedSection=line.closest('.graph-edge').dataset.section;
      const selectedColor=selectedSection?getComputedStyle(document.querySelector('.rail-item[data-section="'+selectedSection+'"]')).color:palette[mode].active;
      out.selectedArrowMatches&&=getComputedStyle(line).stroke===selectedColor&&getComputedStyle(line).stroke===getComputedStyle(document.getElementById(markerId).querySelector('path')).fill;
    }
    out.selectionAura=getComputedStyle(document.querySelector('.graph-focus')).display!=='none'&&document.querySelectorAll('.focus-ring').length===2&&document.querySelectorAll('.glow-node.is-primary').length===1;
    const selected='3458764686135623239';const neighbors=[...new Set(data.connections.filter(e=>e.start_node_id===selected||e.end_node_id===selected).flatMap(e=>[e.start_node_id,e.end_node_id]))].filter(n=>n!==selected);
    out.neighborOwnership=neighbors.length===document.querySelectorAll('.graph-node.is-neighbor').length&&neighbors.every(id=>document.querySelector('.graph-node[data-id="'+id+'"]').classList.contains('is-neighbor'));
    q('index-button').click();q('nodes-tab').click();q('search-input').value='EM08';q('search-input').dispatchEvent(new Event('input'));
    const searchBox=q('search-input').getBoundingClientRect();
    out.searchAboveInspector=document.elementFromPoint(searchBox.x+searchBox.width/2,searchBox.y+searchBox.height/2)===q('search-input');
    const matched=q('search-results').querySelector('.result-button');
    out.searchOverridesFade=!!matched&&!document.querySelector('.graph-node[data-id="'+matched.dataset.nodeId+'"]').classList.contains('is-dimmed');
    const indexBefore=q('search-results').textContent;q('theme-paper').click();q('theme-night').click();out.searchStatePreserved=q('search-input').value==='EM08'&&q('search-results').textContent===indexBefore;
    q('close-index').click();out.selectionRestored=document.querySelectorAll('.graph-node.is-neighbor').length===neighbors.length&&document.querySelectorAll('.graph-node.is-dimmed').length===128-neighbors.length-1;
    return out;
  })()`);
  assert(Object.values(theme).every(Boolean),JSON.stringify(theme));
  await screenshot('night-details');
  await cdp('Page.reload');await ready();
  theme.preferencePersists=await evaluate('document.documentElement.dataset.theme === "night" && document.getElementById("theme-night").getAttribute("aria-pressed") === "true"');
  assert(theme.preferencePersists);
  await evaluate('document.getElementById("fit-button").click();new Promise(requestAnimationFrame)');
  await screenshot('night-overview');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await evaluate('document.getElementById("fit-button").click();new Promise(requestAnimationFrame)');
  await screenshot('tablet-night');
  theme.tabletNoOverflow=await evaluate('document.documentElement.scrollWidth<=innerWidth');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('.graph-node[data-id="3458764686135623239"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));new Promise(requestAnimationFrame)`);
  await screenshot('mobile-night');
  theme.mobileNoOverflow=await evaluate('document.documentElement.scrollWidth<=innerWidth');
  theme.mobileNavigation=await evaluate(`(()=>{const nav=document.querySelector('.rail').getBoundingClientRect();return nav.bottom<=innerHeight&&[...document.querySelectorAll('.rail-item')].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth})})()`);
  theme.mobileSourceAccessible=await evaluate(`(()=>{const r=document.getElementById('source-button').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0})()`);
  theme.mobileSearchAboveInspector=await evaluate(`(()=>{document.getElementById('index-button').click();const input=document.getElementById('search-input'),r=input.getBoundingClientRect(),pass=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===input;document.getElementById('close-index').click();return pass})()`);
  assert(theme.mobileNavigation&&theme.mobileSourceAccessible&&theme.mobileSearchAboveInspector);
  assert(theme.tabletNoOverflow&&theme.mobileNoOverflow);
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  theme.reducedMotionRespected=await evaluate(`(()=>{document.querySelector('.graph-node.is-selected').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return [...document.querySelectorAll('.focus-ring')].every(n=>getComputedStyle(n).animationName==='none')})()`);
  assert(theme.reducedMotionRespected);
  await cdp('Emulation.setEmulatedMedia',{features:[]});
  await evaluate('document.getElementById("theme-paper").click()');
  assert.equal(errors.length,0,'Browser runtime errors');
  await writeFile('.preview/browser-report.json',JSON.stringify({status:'passed',...report,interaction,mobile,theme,runtimeErrors:errors},null,2));
  console.log(JSON.stringify({status:'passed',checks:report.checks.length,sidebars:128,connections:181,interaction,mobile,theme,runtimeErrors:errors.length}));
}finally{socket.close();}
