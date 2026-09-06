'use strict';

const Game=ScenarioSession,Rules=ScenarioRules;
let state=null,guideMode=null;
const byId=id=>document.getElementById(id);
const seed=()=>Math.floor(Math.random()*4294967296)>>>0;
function clear(element){element.replaceChildren()}
function node(tag,text,className){
  const element=document.createElement(tag);
  if(text!==undefined)element.textContent=text;
  if(className)element.className=className;
  return element;
}
function button(label,action,{disabled=false,primary=false,id}={}){
  const element=node('button',label,primary?'primary':'secondary');
  element.type='button';element.disabled=disabled;element.onclick=action;if(id)element.id=id;
  return element;
}
function paragraph(text){return node('p',text)}
function scenarioConfig(){return Rules.getScenario(state.scenario)}
function initialSetup(){
  const params=typeof location==='undefined'?null:new URLSearchParams(location.search);
  const number=Number(params?.get('scenario'))||1;
  const requestedSeed=params?.has('seed')?Number(params.get('seed')):seed();
  const select=byId('scenarioSelect');clear(select);
  for(const c of Object.values(Rules.SCENARIOS)){
    const option=node('option',c.number+' · '+c.title);option.value=String(c.number);select.appendChild(option);
  }
  startScenario(Object.hasOwn(Rules.SCENARIOS,number)?number:1,requestedSeed);
}
function startScenario(number,requestedSeed=seed()){
  try{
    const deal=ScenarioDeck.createDeal(number,{seed:requestedSeed});
    state=Game.createState(number,{seed:deal.seed,deck:deal.deck});
    byId('scenarioSelect').value=String(number);
    byId('resultModal').classList.remove('show');byId('guideModal').classList.remove('show');
    guideMode=null;render();openMissionBriefing();
  }catch(error){
    byId('status').textContent='Could not prepare a verified deal. Start a new colony to retry.';
    console.error(error);
  }
}
function startSelectedScenario(){startScenario(Number(byId('scenarioSelect').value))}
function repeatScenario(){if(state)startScenario(state.scenario)}
function nextScenario(){if(state?.result==='win'&&state.scenario<4)startScenario(state.scenario+1)}
function act(type,fields={}){
  const phase=state.phase,focused=document.activeElement?.id;
  const accepted=Game.dispatch(state,{type,...fields});
  if(!accepted)return false;
  render();
  if(!state.result){
    const focus=phase===state.phase&&focused?byId(focused):byId('phaseTitle');
    if(focus&&!focus.disabled)focus.focus();
  }
  return true;
}
function endRound(){
  if(state.phase==='allocation')act('finishAllocation');
  act('endTurn');
}
function requestColonists(){
  if(state.phase==='allocation')act('finishAllocation');
  act('requestArrival');
}
function launchNow(){
  if(!Game.allArrived(state)||state.result)return;
  if(state.phase==='allocation')act('finishAllocation');
  if(state.phase==='end'){
    if(Game.canLaunchAutonomyEarly(state)){act('earlyAutonomy');return}
    act('endTurn');
  }
  if(state.phase==='ready')act('launchAutonomy');
}
function reviewResult(){act('reviewResult');byId('phaseTitle').focus()}
function syncModalAccess(){
  const open=byId('guideModal').classList.contains('show')||byId('resultModal').classList.contains('show');
  document.querySelector('.app').inert=open;document.body.style.overflow=open?'hidden':'';
}
function showGuide(title,lines){
  byId('guideTitle').textContent=title;clear(byId('guideBody'));
  for(const line of lines)byId('guideBody').appendChild(paragraph(line));
  byId('guideProgress').textContent='SCENARIO '+state.scenario;
  byId('guidePrimary').textContent='Continue';
  byId('guideModal').classList.add('show');syncModalAccess();byId('guidePrimary').focus();
}
function openMissionBriefing(){
  guideMode='mission';
  const c=scenarioConfig(),lines=[
    c.size+'×'+c.size+' field. '+c.population+' colonists. Keep everyone awake for '+c.autonomyRounds+' autonomous rounds.',
    c.waves.map((wave,i)=>(c.waves.length>1?'Arrival '+(i+1)+': ':'Arrival: ')+wave.count+' colonists by round '+wave.round+'.').join(' '),
    'You may receive colonists and launch autonomy early.'
  ];
  if(c.number===1)lines.push('Build Water, Oxygen and power. Each colonist needs 1 Water and 1 Oxygen per round.');
  if(c.number===2)lines.push('A total solar eclipse will occur during one autonomous round.');
  if(c.food)lines.push('Colonists also need 1 Food per round. Greenhouses use Water to produce Food.',
    'Connected facilities share a crew. Expand beside matching tiles.');
  if(c.wastewater)lines.push('The Recycler stores Wastewater even while OFF. Recycling uses Wastewater collected in earlier rounds.',
    'Prepare for the second arrival with more Food, power and recycling.');
  showGuide(c.title,lines);
}
function reopenStageBriefing(){
  if(!state)return;guideMode='stage';
  const lines={
    build:['Build one facility or expand it, cycle the Module Bay, or pass.',
      'Water, Oxygen and Recycler are placed in pairs. Connected matching tiles form one facility and share a crew.'],
    drop:['Select the required modules, then recycle them together. Carry up to five.'],
    arrival:['Place a Habitat connected to Starport through occupied cells. It houses the entire arriving group.'],
    allocation:['Assign a full crew to turn a facility ON. Unassigned colonists still need life support.',
      'Facilities operate in construction order. Expansion keeps the original position.',
      'Solar production and stored battery power supply facilities. Remaining power charges batteries.'],
    end:['End the round to resolve production. You may receive the next arrival early.',
      'After everyone arrives, you may launch autonomy early.'],
    ready:['Start the ten-round test. You cannot intervene during autonomy.'],
    result:['Review the turn log, repeat the scenario, or continue after success.']
  };
  showGuide(phaseUI().title,lines[state.phase]||[]);
}
function advanceGuide(){closeGuide()}
function closeGuide(){
  byId('guideModal').classList.remove('show');guideMode=null;syncModalAccess();byId('phaseTitle').focus();
}
function phaseUI(){
  const phase=state.phase;
  if(phase==='build')return {title:state.selectedBuild?'Place '+Rules.TYPES[state.selectedBuild].name:'Build',
    instruction:state.selectedBuild?'Select empty cells, then confirm placement.':'Build, expand, cycle the Module Bay, or pass.'};
  if(phase==='drop')return {title:'Module Recycle',instruction:'Select exactly '+state.discardRequired+' to recycle ('+state.pendingRecycle.length+' selected).'};
  if(phase==='arrival')return {title:'Arrival',instruction:Game.nextWave(state).count+' colonists. Choose a connected landing site.'};
  if(phase==='allocation')return {title:'Crew Allocation',instruction:Game.allArrived(state)
    ?'Assign the crew, then end the round or start autonomy.':'Assign the crew before continuing.'};
  if(phase==='end')return {title:'End Round',instruction:'Review production before continuing.'};
  if(phase==='ready')return {title:'Autonomy ready',instruction:'Start the autonomous survival test.'};
  return {title:state.result==='win'?'Scenario passed':'Scenario failed',instruction:state.message};
}
function facilityDescription(f){
  const s=Game.stats(f),text=[];
  if(s.generation)text.push(s.generation+' Power');
  if(s.water)text.push(s.water+' Water');
  if(s.oxygen)text.push(s.oxygen+' Oxygen');
  if(s.food)text.push(s.food+' Food');
  if(s.batteryCapacity)text.push('Stores '+s.batteryCapacity+' Power');
  if(s.wastewaterCapacity)text.push('Stores '+s.wastewaterCapacity+' Wastewater (passive)');
  if(s.housing)text.push('Houses '+s.housing);
  const inputs=[];
  if(s.workers)inputs.push(s.workers+' crew');
  if(s.power)inputs.push(s.power+' Power');
  if(s.waterInput)inputs.push(s.waterInput+' Water');
  if(s.wastewaterInput)inputs.push(s.wastewaterInput+' Wastewater');
  return (inputs.length?inputs.join(' + ')+' → ':'')+text.join(' · ');
}
function renderControls(){
  const controls=byId('controls');clear(controls);
  const add=(label,action,options={})=>controls.appendChild(button(label,action,options));
  if(state.phase==='build'){
    for(const type of Object.keys(scenarioConfig().deck)){
      const def=Rules.TYPES[type],count=Game.countType(state,type);
      add('Build '+def.name+' ('+count+'/'+def.need+')',()=>act('beginBuild',{facility:type}),{disabled:count<def.need,id:'build-'+type});
    }
    add('Cycle Module Bay',()=>act('cycle'),{id:'cycle'});
    add('Pass Build',()=>act('pass'),{id:'pass'});
    if(state.selectedBuild){
      add('Cancel placement',()=>act('cancelBuild'),{id:'cancelBuild'});
      add('Confirm placement',()=>act('confirmBuild'),{primary:true,disabled:!Game.validBuild(state),id:'confirmBuild'});
    }
  }
  if(state.phase==='drop'){
    add('Clear selection',()=>act('clearRecycle'),{disabled:!state.pendingRecycle.length,id:'clearRecycle'});
    add('Confirm recycle ('+state.pendingRecycle.length+')',()=>act('confirmRecycle'),
      {primary:true,disabled:!Game.recycleSelectionValid(state),id:'confirmRecycle'});
  }
  if(state.phase==='arrival'){
    add('Clear site',()=>act('clearLanding'),{disabled:state.pendingLanding===null,id:'clearLanding'});
    add('Confirm deployment',()=>act('confirmLanding'),{primary:true,disabled:state.pendingLanding===null,id:'confirmLanding'});
  }
  if(['allocation','end'].includes(state.phase)){
    const endState={...state,phase:'end'};
    if(state.round<scenarioConfig().managedRounds)add('End round',endRound,{primary:true,id:'endTurn'});
    if(Game.canRequestArrival(endState))add('Ready for '+Game.nextWave(state).count+' colonists',requestColonists,{id:'requestArrival'});
    if(Game.allArrived(state))add('Start autonomy',launchNow,{primary:state.round>=scenarioConfig().managedRounds,id:'launchAutonomy'});
  }
  if(state.phase==='ready')add('Start autonomy',launchNow,{primary:true,id:'launchAutonomy'});
  if(state.result){
    add('Repeat Scenario '+state.scenario,repeatScenario);
    if(state.result==='win'&&state.scenario<4)add('Continue to Scenario '+(state.scenario+1),nextScenario,{primary:true});
  }
}
function renderBoard(){
  const grid=byId('grid'),size=scenarioConfig().size;clear(grid);
  grid.style.gridTemplateColumns='repeat('+(size+2)+', minmax(0, 1fr))';
  grid.style.gridTemplateRows='repeat('+(size+2)+', minmax(0, 1fr))';
  grid.setAttribute('aria-label',size+' by '+size+' colony field; Starport is outside');
  const port=node('div','Starport','cell starport external-starport');
  port.id='starport';port.style.gridRow=String(state.starport.row+2);port.style.gridColumn=String(state.starport.col+2);
  port.setAttribute('aria-label','Starport outside the '+state.starport.side+' edge');grid.appendChild(port);
  state.board.forEach((tile,index)=>{
    const pending=state.pendingCells.includes(index)||state.pendingLanding===index;
    const type=tile?.type||(pending?(state.phase==='arrival'?'landing':state.selectedBuild):null);
    const landing=state.phase==='arrival'&&Game.connectedIfLanding(state,index);
    const label=tile?(type==='landing'?'Habitat · '+tile.capacity:Rules.TYPES[type].name)
      :pending?(type==='landing'?'Habitat':Rules.TYPES[type].name):null;
    const cell=button('',()=>act('cell',{index}),{id:'cell-'+index});
    cell.className='cell '+(type||'empty')+(pending?' pending':'')+(landing?' landing-target':'');
    cell.style.gridRow=String(Math.floor(index/size)+2);cell.style.gridColumn=String(index%size+2);
    cell.setAttribute('aria-label',(label||'Empty cell')+' '+(Math.floor(index/size)+1)+', '+(index%size+1));
    if(label){
      cell.appendChild(node('strong',label));
      const f=state.facilities.find(f=>f.cells.includes(index));
      if(f)cell.appendChild(node('small','#'+f.order));
    }else cell.appendChild(node('span',(Math.floor(index/size)+1)+','+(index%size+1),'coordinate'));
    grid.appendChild(cell);
  });
  byId('boardSize').textContent=size+'×'+size+' · '+state.board.filter(Boolean).length+'/'+state.board.length+' occupied';
}
function renderHand(){
  const hand=byId('hand');clear(hand);
  for(const card of state.hand){
    const selected=state.pendingRecycle.includes(card.id),interactive=state.phase==='drop';
    const locked=!interactive||(!selected&&state.pendingRecycle.length>=state.discardRequired);
    const element=interactive?button('',()=>act('toggleRecycle',{id:card.id}),{disabled:locked,id:'module-'+card.id}):node('div');
    element.className='card'+(selected?' recycle-selected':'')+(interactive&&!locked?' interactive':'');
    if(interactive){
      element.setAttribute('aria-label',(selected?'Remove ':'Add ')+Rules.TYPES[card.type].name+(selected?' from':' to')+' recycle selection');
      element.setAttribute('aria-pressed',String(selected));
    }
    element.appendChild(node('b',Rules.TYPES[card.type].name));
    element.appendChild(node('small',facilityDescription({type:card.type})));
    hand.appendChild(element);
  }
  byId('handCount').textContent=state.hand.length+' modules';
  byId('drawInfo').textContent=state.phase==='drop'?state.pendingRecycle.length+'/'+state.discardRequired+' selected':'Build with these modules.';
}
function renderFacilities(){
  const element=byId('facilities');clear(element);
  for(const f of state.facilities){
    const box=node('div',undefined,'facility'),head=node('div',undefined,'facility-head');
    head.appendChild(node('b',Rules.TYPES[f.type].name+' #'+f.order+' · '+f.cells.length+' tiles'));
    head.appendChild(node('span',facilityDescription(f)));box.appendChild(head);
    const s=Game.stats(f);
    if(s.workers&&state.arrived){
      const control=node('div',undefined,'worker-control'),label=node('label','Crew');
      label.htmlFor='workers-'+f.id;
      const select=node('select');select.id='workers-'+f.id;select.disabled=state.phase!=='allocation';
      select.setAttribute('aria-label',Rules.TYPES[f.type].name+' #'+f.order+' crew');
      for(const value of [0,s.workers]){
        const option=node('option',value+' workers · '+(value?'ON':'OFF'));
        option.value=String(value);option.selected=f.workers===value;select.appendChild(option);
      }
      select.value=String(f.workers);
      select.onchange=()=>{if(!act('workers',{id:f.id,value:select.value})){render();byId(select.id)?.focus();byId('status').textContent='Not enough unassigned colonists.'}};
      control.appendChild(label);control.appendChild(select);box.appendChild(control);
    }
    element.appendChild(box);
  }
  if(!state.facilities.length)element.appendChild(paragraph('No facilities yet.'));
}
function renderResources(){
  const resources=byId('resources');clear(resources);
  const values=[['Awake',state.awake],['Cryosleep',state.cryo],['Battery',state.battery+'/'+Game.batteryCapacity(state.facilities)],
    ['Power produced',state.lastPower],['Water produced',state.lastWater],['Oxygen produced',state.lastOxygen]];
  if(scenarioConfig().food)values.push(['Food produced',state.lastFood]);
  if(scenarioConfig().wastewater)values.push(['Wastewater',state.wastewater+'/'+Game.wastewaterCapacity(state.facilities)]);
  for(const [label,value] of values){
    const item=node('div',label,'resource');item.appendChild(node('b',String(value)));resources.appendChild(item);
  }
  byId('workerSummary').textContent=state.arrived?Game.assignedWorkers(state.facilities)+'/'+state.awake+' crew assigned':'Awaiting colonists';
  byId('allocationNote').textContent=state.phase==='allocation'?'Review staffing before continuing.':'';
  const wave=Game.nextWave(state);
  byId('arrivalBanner').textContent=wave?'Next arrival: '+wave.count+' colonists by round '+wave.round+'.':'All colonists have arrived.';
  byId('arrivalBanner').className='banner';
}
function renderResult(){
  const modal=byId('resultModal'),wasOpen=modal.classList.contains('show');
  const show=Boolean(state.result)&&!state.resultAcknowledged,won=state.result==='win';
  byId('resultTitle').textContent=won?'Colony passed the autonomous survival test':'Scenario failed';
  byId('resultPill').textContent='SCENARIO '+state.scenario+' · '+(won?'PASSED':'FAILED');
  byId('resultBody').textContent=won?state.awake+' colonists survived '+scenarioConfig().autonomyRounds+' autonomous rounds.':state.failureReason;
  byId('resultRepeat').textContent='Repeat Scenario '+state.scenario;
  byId('resultNext').hidden=!(won&&state.scenario<4);
  byId('resultNext').textContent='Continue to Scenario '+(state.scenario+1);
  modal.classList.toggle('failed',!won);modal.classList.toggle('show',show);syncModalAccess();
  if(show&&!wasOpen)byId(won&&state.scenario<4?'resultNext':'resultRepeat').focus();
}
function render(){
  if(!state)return;
  const c=scenarioConfig(),ui=phaseUI();
  document.title='Mars. Colonize — Scenario '+state.scenario+': '+c.title;
  byId('scenarioSubtitle').textContent='Scenario '+state.scenario+' · '+c.title;
  byId('phaseTitle').textContent=ui.title;byId('phaseInstruction').textContent=ui.instruction;
  byId('status').textContent=state.message;byId('dealSeed').textContent='Deal '+state.seed;
  clear(byId('roundPills'));
  for(const label of ['Round '+state.round+'/'+c.managedRounds,ui.title,'Supply '+state.deck.length,'Recycle '+state.discard.length])
    byId('roundPills').appendChild(node('span',label,'pill'));
  clear(byId('stageTrack'));
  for(const [key,label] of [['build','Build'],['drop','Recycle'],['arrival','Arrival'],['allocation','Crew'],['end','Resolve'],['ready','Autonomy']]){
    byId('stageTrack').appendChild(node('div',label,'stage'+(state.phase===key?' active':'')));
  }
  renderControls();renderBoard();renderHand();renderFacilities();renderResources();
  clear(byId('log'));for(const line of state.log)byId('log').appendChild(node('div',line));
  renderResult();
}
document.addEventListener('keydown',event=>{
  const modal=document.querySelector('.modal.show');if(!modal)return;
  if(event.key==='Escape'){event.preventDefault();if(modal.id==='guideModal')closeGuide();else reviewResult();return}
  if(event.key!=='Tab')return;
  const buttons=[...modal.querySelectorAll('button')].filter(b=>!b.hidden&&b.style.display!=='none'&&!b.disabled);
  const first=buttons[0],last=buttons[buttons.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
});
initialSetup();
