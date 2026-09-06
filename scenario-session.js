(function(root,factory){
  const rules=typeof module==='object'&&module.exports?require('./scenario-rules.js'):root.ScenarioRules;
  const api=factory(rules);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ScenarioSession=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Rules){
  'use strict';

  const config=state=>Rules.getScenario(state.scenario||1);
  const stats=Rules.facilityStats;
  const sum=(facilities,key)=>facilities.reduce((total,f)=>total+stats(f)[key],0);
  const batteryCapacity=(facilities=[])=>sum(facilities,'batteryCapacity');
  const wastewaterCapacity=(facilities=[])=>sum(facilities,'wastewaterCapacity');
  const assignedWorkers=(facilities=[])=>facilities.reduce((total,f)=>total+(f.workers||0),0);
  const countType=(state,type)=>state.hand.filter(card=>card.type===type).length;
  function addLog(state,message){state.log.unshift(message)}
  function syncCrew(state){
    if(!state.crew)return;
    state.awake=state.crew.filter(person=>person.awake).length;
    state.cryo=state.crew.length-state.awake;
    for(const facility of state.facilities){
      facility.workers=state.crew.filter(person=>person.awake&&person.assignment===facility.id).length;
    }
  }
  function createState(number=1,{seed=1,deck}={}){
    const c=Rules.getScenario(number);
    const state={scenario:number,seed:seed>>>0,round:1,phase:'build',board:Array(c.size*c.size).fill(null),
      starport:Rules.starport(c.size,seed),deck:(deck||Rules.createDeck(number,seed)).map(card=>({...card})),
      hand:[],discard:[],reshuffles:0,facilities:[],buildOrder:0,buildSpent:false,
      selectedBuild:null,pendingCells:[],pendingRecycle:[],discardRequired:0,pendingLanding:null,
      arrivals:[],lastArrivalRound:0,crew:[],awake:0,cryo:0,arrived:false,
      battery:0,wastewater:0,lastPower:0,lastWater:0,lastOxygen:0,lastFood:0,lastReport:null,
      autonomy:false,eclipseOccurred:false,result:null,resultAcknowledged:false,failureReason:'',
      message:'Build, cycle the Module Bay, or pass.',log:[],history:[]};
    for(let i=0;i<5;i++){const card=drawOne(state);if(card)state.hand.push(card)}
    addLog(state,'Scenario '+number+': new colony. Deal '+state.seed+'.');
    return state;
  }
  function drawOne(state){
    if(!state.deck.length){
      if(!state.discard.length)return null;
      state.reshuffles++;
      state.deck=Rules.shuffle([...state.discard].sort((a,b)=>a.id.localeCompare(b.id)),
        (state.seed+Math.imul(state.reshuffles,0x9e3779b9))>>>0);
      state.discard=[];
      addLog(state,'Recycled modules returned to supply.');
    }
    return state.deck.pop()||null;
  }
  function failure(state,message){
    state.result='lose';state.phase='result';state.failureReason=message;state.message=message;
    state.resultAcknowledged=false;state.pendingLanding=null;
    addLog(state,message);
  }
  function nextWave(state){return config(state).waves[state.arrivals.length]||null}
  function allArrived(state){return state.arrivals.length===config(state).waves.length}
  function canRequestArrival(state){
    const wave=nextWave(state);
    return Boolean(wave)&&state.phase==='end'&&!state.result&&state.lastArrivalRound!==state.round;
  }
  function canLaunchAutonomyEarly(state,scenario=config(state)){
    // Compatibility for simple historic eligibility fixtures without wave state.
    const complete=state.arrivals?allArrived(state):state.arrived;
    return state.phase==='end'&&complete&&!state.result&&state.round<scenario.managedRounds;
  }
  function connectedIfLanding(state,index){
    const size=config(state).size;
    if(!Rules.validCell(index,size)||state.board[index])return false;
    const queue=[index],seen=new Set(queue);
    while(queue.length){
      const cell=queue.shift();
      if(cell===state.starport.entry)return true;
      for(const neighbor of Rules.neighbors(cell,size)){
        if(state.board[neighbor]&&!seen.has(neighbor)){seen.add(neighbor);queue.push(neighbor)}
      }
    }
    return false;
  }
  function beginArrival(state){
    if(!nextWave(state)||state.lastArrivalRound===state.round)return false;
    if(!state.board.some((cell,index)=>!cell&&connectedIfLanding(state,index))){
      failure(state,'No connected landing site remains. Reserve a site for each arrival.');return true;
    }
    state.phase='arrival';state.pendingLanding=null;
    state.message='Place the arriving Habitat on a highlighted site.';
    addLog(state,'Transport ready: '+nextWave(state).count+' colonists.');
    return true;
  }
  function afterDelivery(state){
    const wave=nextWave(state);
    if(wave&&state.round>=wave.round&&state.lastArrivalRound!==state.round){beginArrival(state);return}
    state.phase=state.arrived?'allocation':'end';
    state.message=state.arrived?'Assign the crew.':'Ready to end the round or receive colonists early.';
  }
  function deliver(state){
    let received=0;
    for(let i=0;i<3;i++){const card=drawOne(state);if(card){state.hand.push(card);received++}}
    state.discardRequired=Math.max(0,state.hand.length-5);state.pendingRecycle=[];
    addLog(state,'Round '+state.round+': received '+received+' modules.');
    if(state.discardRequired===0){afterDelivery(state);return}
    state.phase='drop';
    state.message='Recycle exactly '+state.discardRequired+'.';
  }
  function validBuild(state){
    const def=Rules.TYPES[state.selectedBuild],cells=state.pendingCells,size=config(state).size;
    return state.phase==='build'&&!state.buildSpent&&Boolean(def)
      &&countType(state,state.selectedBuild)>=def.need
      &&cells.length===def.need&&new Set(cells).size===def.need
      &&cells.every(cell=>Rules.validCell(cell,size)&&!state.board[cell])
      &&(def.need===1||Rules.neighbors(cells[0],size).includes(cells[1]));
  }
  function rebuildFacilities(state){
    const oldByCell=new Map();
    for(const f of state.facilities)for(const cell of f.cells)oldByCell.set(cell,f);
    const seen=new Set(),facilities=[],size=config(state).size;
    for(let start=0;start<state.board.length;start++){
      const tile=state.board[start];
      if(!tile||tile.type==='landing'||seen.has(start))continue;
      const queue=[start],cells=[];seen.add(start);
      while(queue.length){
        const cell=queue.shift();cells.push(cell);
        for(const n of Rules.neighbors(cell,size)){
          if(!seen.has(n)&&state.board[n]&&state.board[n].type===tile.type){seen.add(n);queue.push(n)}
        }
      }
      cells.sort((a,b)=>a-b);
      const order=Math.min(...cells.map(cell=>state.board[cell].order));
      const facility={id:tile.type+'-'+order,type:tile.type,order,cells,workers:0};
      const oldIDs=new Set(cells.map(cell=>oldByCell.get(cell)?.id).filter(Boolean));
      const candidates=state.crew.filter(person=>person.awake&&oldIDs.has(person.assignment));
      for(const [i,person] of candidates.entries())person.assignment=i<stats(facility).workers?facility.id:null;
      facilities.push(facility);
    }
    state.facilities=facilities.sort((a,b)=>a.order-b.order);
    syncCrew(state);
  }
  function setWorkers(state,id,value){
    const f=state.facilities.find(facility=>facility.id===id),workers=Number(value);
    if(state.phase!=='allocation'||!f||!state.arrived||state.result)return false;
    const required=stats(f).workers;
    if(!required||![0,required].includes(workers))return false;
    if(assignedWorkers(state.facilities)-(f.workers||0)+workers>state.awake)return false;
    for(const person of state.crew)if(person.assignment===id)person.assignment=null;
    if(workers){
      const available=state.crew.filter(person=>person.awake&&!person.assignment);
      for(const person of available.slice(0,workers))person.assignment=id;
    }
    syncCrew(state);
    state.message='Crew assigned: '+assignedWorkers(state.facilities)+'/'+state.awake+'.';
    return true;
  }
  function resolveProduction(state,{eclipse=false}={}){
    const facilities=state.facilities||[],c=config(state);
    syncCrew(state);
    const awakeBefore=Math.max(0,state.awake||0);
    if(awakeBefore===0)for(const facility of facilities)facility.workers=0;
    const generatedPower=eclipse?0:sum(facilities,'generation');
    const initialStoredPower=Math.max(0,state.battery||0);
    const availablePower=generatedPower+initialStoredPower;
    let power=availablePower,water=0,oxygen=0,food=0,wastewater=Math.max(0,state.wastewater||0);
    let waterProduced=0,waterUsedByFacilities=0,wastewaterUsed=0,poweredLoads=0;
    const operations=[],activeFacilityOrders=[];
    for(const facility of [...facilities].sort((a,b)=>a.order-b.order)){
      const s=stats(facility);
      if(!s.workers)continue;
      if(facility.workers===s.workers)activeFacilityOrders.push(facility.order);
      let reason=null;
      if(facility.workers!==s.workers)reason='crew';
      else if(power<s.power)reason='Power';
      else if(water<s.waterInput)reason='Water';
      else if(wastewater<s.wastewaterInput)reason='Wastewater';
      if(reason){operations.push({id:facility.id,order:facility.order,type:facility.type,ran:false,reason});continue}
      power-=s.power;poweredLoads++;
      water-=s.waterInput;waterUsedByFacilities+=s.waterInput;
      wastewater-=s.wastewaterInput;wastewaterUsed+=s.wastewaterInput;
      water+=s.water;waterProduced+=s.water;oxygen+=s.oxygen;food+=s.food;
      operations.push({id:facility.id,order:facility.order,type:facility.type,ran:true,power:s.power,
        water:s.water,waterInput:s.waterInput,oxygen:s.oxygen,food:s.food,wastewaterInput:s.wastewaterInput});
    }
    const supported=Math.min(awakeBefore,water,oxygen,c.food?food:awakeBefore);
    const lost=awakeBefore-supported;
    if(state.crew){
      // Colonists are ordered by deployment. Suspend newest first.
      const awake=state.crew.filter(person=>person.awake);
      for(const person of awake.slice(supported)){person.awake=false;person.assignment=null}
      syncCrew(state);
    }else{
      state.awake=supported;state.cryo=(state.cryo||0)+lost;
      let excess=Math.max(0,assignedWorkers(facilities)-supported);
      for(const f of [...facilities].sort((a,b)=>b.order-a.order)){
        const removed=Math.min(excess,f.workers||0);f.workers-=removed;excess-=removed;
      }
    }
    const capacity=c.wastewater?wastewaterCapacity(facilities):0;
    const wastewaterGenerated=c.wastewater?supported:0;
    const wastewaterOverflow=Math.max(0,wastewater+wastewaterGenerated-capacity);
    state.wastewater=Math.min(capacity,wastewater+wastewaterGenerated);
    state.battery=Math.min(batteryCapacity(facilities),power);
    state.lastPower=generatedPower;state.lastWater=waterProduced;
    state.lastOxygen=oxygen;state.lastFood=food;
    if(eclipse)state.eclipseOccurred=true;
    const report={generatedPower,initialStoredPower,availablePower,poweredLoads,powerUsed:availablePower-power,
      usedStoredPower:Math.max(0,availablePower-power-generatedPower),storedPower:state.battery,
      eclipse,water:waterProduced,waterAvailable:water,waterUsedByFacilities,oxygen,food,
      waterConsumed:supported,oxygenConsumed:supported,foodConsumed:c.food?supported:0,
      wastewaterUsed,wastewaterGenerated,wastewaterStored:state.wastewater,wastewaterOverflow,
      awakeBefore,awakeAfter:state.awake||0,lost,activeFacilityOrders,operations};
    state.lastReport=report;
    return report;
  }
  function logProduction(state,label,report){
    addLog(state,label+': Power '+report.generatedPower+' generated + '+report.initialStoredPower+
      ' stored; '+report.powerUsed+' used; '+report.storedPower+' stored for next round.');
    if(config(state).food)addLog(state,label+': Water '+report.water+' produced, '+report.waterUsedByFacilities+
      ' used by facilities, '+report.waterConsumed+' consumed by colonists. Food '+report.food+' produced.');
    if(config(state).wastewater)addLog(state,label+': Wastewater '+report.wastewaterUsed+
      ' recycled; '+report.wastewaterGenerated+' collected; '+report.wastewaterStored+' stored, '+report.wastewaterOverflow+' overflow.');
    if(report.eclipse)addLog(state,label+': solar eclipse. Battery supplied '+report.usedStoredPower+' Power.');
    for(const op of report.operations.filter(op=>!op.ran&&op.reason!=='crew')){
      addLog(state,label+': '+Rules.TYPES[op.type].name+' #'+op.order+' skipped: insufficient '+op.reason+'.');
    }
    if(report.awakeBefore)addLog(state,label+': '+report.awakeAfter+'/'+report.awakeBefore+' colonists supported.');
  }
  function runAutonomy(state,{rounds=config(state).autonomyRounds,eclipseRound=null,
    requiredAwake=config(state).population,onRound}={}){
    const reports=[];
    if((state.awake||0)<requiredAwake)return {result:'lose',failedRound:0,reports};
    for(let round=1;round<=rounds;round++){
      const report={round,...resolveProduction(state,{eclipse:round===eclipseRound})};reports.push(report);
      if(onRound)onRound(report);
      if(state.awake<requiredAwake)return {result:'lose',failedRound:round,reports};
    }
    return {result:'win',failedRound:null,reports};
  }
  function launchAutonomy(state){
    if(state.phase!=='ready'||!allArrived(state)||state.result)return false;
    state.autonomy=true;state.eclipseOccurred=false;
    addLog(state,'Autonomy started.');
    const outcome=runAutonomy(state,{eclipseRound:config(state).eclipseRound,
      onRound:report=>logProduction(state,'Autonomy '+report.round,report)});
    if(outcome.result==='lose'){
      failure(state,'Autonomy failed on round '+outcome.failedRound+'. Some colonists entered cryosleep.');
    }else{
      state.result='win';state.phase='result';state.resultAcknowledged=false;
      state.message='Colony passed the autonomous survival test.';
      addLog(state,'Scenario '+state.scenario+' passed: '+state.awake+' colonists, '+config(state).autonomyRounds+' autonomous rounds.');
    }
    return true;
  }
  function finishTurn(state,early=false){
    if(state.phase!=='end'||state.result||(early&&!canLaunchAutonomyEarly(state)))return false;
    const report=resolveProduction(state);
    logProduction(state,'Round '+state.round,report);
    if(report.lost){failure(state,'Life support failed. Cryosleep is permanent; repeat the scenario to try again.');return true}
    if(early||state.round>=config(state).managedRounds){
      state.phase='ready';state.message='Ready for autonomy.';
      if(early)launchAutonomy(state);
      return true;
    }
    state.round++;state.phase='build';state.buildSpent=false;state.selectedBuild=null;state.pendingCells=[];
    state.message='Build, cycle the Module Bay, or pass.';
    return true;
  }
  function dispatch(state,command){
    if(!command||typeof command.type!=='string')return false;
    if(state.result){
      if(command.type==='reviewResult'){state.resultAcknowledged=true;return true}
      return false;
    }
    let accepted=false;
    switch(command.type){
      case 'beginBuild':{
        const def=Rules.TYPES[command.facility];
        if(state.phase!=='build'||state.buildSpent||!def||!config(state).deck[command.facility]
          ||countType(state,command.facility)<def.need)break;
        state.selectedBuild=command.facility;state.pendingCells=[];
        state.message='Select '+def.need+' adjacent empty '+(def.need===1?'cell.':'cells.');accepted=true;break;
      }
      case 'cell':{
        const index=command.index,size=config(state).size;
        if(!Rules.validCell(index,size))break;
        if(state.phase==='arrival'){
          if(!connectedIfLanding(state,index))break;
          state.pendingLanding=state.pendingLanding===index?null:index;accepted=true;break;
        }
        if(state.phase!=='build'||state.buildSpent||!state.selectedBuild||state.board[index])break;
        const position=state.pendingCells.indexOf(index),need=Rules.TYPES[state.selectedBuild].need;
        if(position>=0)state.pendingCells.splice(position,1);
        else if(need===1)state.pendingCells=[index];
        else if(state.pendingCells.length===0)state.pendingCells=[index];
        else if(state.pendingCells.length===1&&Rules.neighbors(state.pendingCells[0],size).includes(index))state.pendingCells.push(index);
        else break;
        accepted=true;break;
      }
      case 'cancelBuild':
        if(state.phase!=='build'||state.buildSpent)break;
        state.selectedBuild=null;state.pendingCells=[];accepted=true;break;
      case 'confirmBuild':{
        if(!validBuild(state))break;
        const type=state.selectedBuild,need=Rules.TYPES[type].need,order=++state.buildOrder;
        for(let i=0;i<need;i++)state.hand.splice(state.hand.findIndex(card=>card.type===type),1);
        for(const index of state.pendingCells)state.board[index]={type,order};
        rebuildFacilities(state);state.buildSpent=true;state.selectedBuild=null;state.pendingCells=[];
        addLog(state,'Round '+state.round+': built '+Rules.TYPES[type].name+' ('+need+' '+(need===1?'tile':'tiles')+').');
        deliver(state);accepted=true;break;
      }
      case 'pass':
      case 'cycle':{
        if(state.phase!=='build'||state.buildSpent)break;
        if(command.type==='cycle'){
          const count=state.hand.length;state.discard.push(...state.hand.splice(0));
          for(let i=0;i<count;i++){const card=drawOne(state);if(card)state.hand.push(card)}
        }
        state.selectedBuild=null;state.pendingCells=[];state.buildSpent=true;
        addLog(state,'Round '+state.round+': '+(command.type==='pass'?'passed Build.':'cycled Module Bay.'));
        deliver(state);accepted=true;break;
      }
      case 'toggleRecycle':{
        if(state.phase!=='drop'||!state.hand.some(card=>card.id===command.id))break;
        const index=state.pendingRecycle.indexOf(command.id);
        if(index>=0)state.pendingRecycle.splice(index,1);
        else if(state.pendingRecycle.length<state.discardRequired)state.pendingRecycle.push(command.id);
        else break;
        accepted=true;break;
      }
      case 'clearRecycle':
        if(state.phase!=='drop')break;
        state.pendingRecycle=[];accepted=true;break;
      case 'confirmRecycle':{
        if(!recycleSelectionValid(state))break;
        const selected=new Set(state.pendingRecycle);
        state.discard.push(...state.hand.filter(card=>selected.has(card.id)));
        state.hand=state.hand.filter(card=>!selected.has(card.id));
        state.pendingRecycle=[];state.discardRequired=0;afterDelivery(state);accepted=true;break;
      }
      case 'requestArrival':
        if(!canRequestArrival(state))break;
        accepted=beginArrival(state);break;
      case 'clearLanding':
        if(state.phase!=='arrival')break;
        state.pendingLanding=null;accepted=true;break;
      case 'confirmLanding':{
        if(state.phase!=='arrival'||state.pendingLanding===null||!connectedIfLanding(state,state.pendingLanding))break;
        const wave=nextWave(state);
        if(!wave||state.lastArrivalRound===state.round)break;
        const waveNumber=state.arrivals.length+1;
        state.board[state.pendingLanding]={type:'landing',capacity:wave.count,wave:waveNumber};
        state.arrivals.push({count:wave.count,round:state.round,cell:state.pendingLanding});
        for(let i=0;i<wave.count;i++)state.crew.push({id:state.crew.length+1,awake:true,assignment:null,wave:waveNumber});
        state.lastArrivalRound=state.round;state.arrived=true;state.pendingLanding=null;
        syncCrew(state);state.phase='allocation';state.message='Assign the crew.';
        addLog(state,'Arrival '+waveNumber+': '+wave.count+' colonists deployed.');accepted=true;break;
      }
      case 'workers':accepted=setWorkers(state,command.id,command.value);break;
      case 'finishAllocation':
        if(state.phase!=='allocation')break;
        state.phase='end';state.message='End the round, receive colonists, or launch autonomy when ready.';accepted=true;break;
      case 'endTurn':accepted=finishTurn(state);break;
      case 'earlyAutonomy':accepted=finishTurn(state,true);break;
      case 'launchAutonomy':accepted=launchAutonomy(state);break;
    }
    if(accepted)state.history.push(JSON.parse(JSON.stringify(command)));
    return accepted;
  }
  function recycleSelectionValid(state){
    return state.phase==='drop'&&state.discardRequired===Math.max(0,state.hand.length-5)
      &&state.pendingRecycle.length===state.discardRequired
      &&new Set(state.pendingRecycle).size===state.discardRequired
      &&state.pendingRecycle.every(id=>state.hand.some(card=>card.id===id));
  }
  return Object.freeze({createState,dispatch,config,stats,countType,batteryCapacity,wastewaterCapacity,
    assignedWorkers,resolveProduction,runAutonomy,canRequestArrival,canLaunchAutonomyEarly,
    connectedIfLanding,validBuild,recycleSelectionValid,nextWave,allArrived});
});
