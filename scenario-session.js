(function(root,factory){
  const rules=typeof module==='object'&&module.exports?require('./scenario-rules.js'):root.ScenarioRules;
  const api=factory(rules);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ScenarioSession=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(ScenarioRules){
  'use strict';

  const LIFE_SUPPORT_OUTPUT=4;
  const LIFE_SUPPORT_WORKERS=2;

  function batteryCapacity(facilities=[]){
    return facilities.filter(facility=>facility.type==='battery').length*2;
  }

  function assignedWorkers(facilities=[]){
    return facilities.reduce((total,facility)=>total+(facility.workers||0),0);
  }

  function resolveProduction(state,{eclipse=false}={}){
    const facilities=state.facilities||[];
    const awakeBefore=Math.max(0,state.awake||0);
    // A sleeping or not-yet-arrived crew cannot operate life support.
    if(awakeBefore===0)for(const facility of facilities)facility.workers=0;
    const ordered=[...facilities].sort((a,b)=>a.order-b.order);
    const active=ordered.filter(facility=>(facility.type==='water'||facility.type==='oxygen')&&facility.workers===LIFE_SUPPORT_WORKERS);
    const power=ScenarioRules.resolvePower({
      solarPlants:facilities.filter(facility=>facility.type==='solar').length,
      storedPower:state.battery,
      batteryCapacity:batteryCapacity(facilities),
      requestedLoads:active.length,
      eclipse
    });
    let water=0;
    let oxygen=0;
    for(let index=0;index<power.poweredLoads;index++){
      if(active[index].type==='water')water+=LIFE_SUPPORT_OUTPUT;
      else oxygen+=LIFE_SUPPORT_OUTPUT;
    }
    const supported=Math.min(awakeBefore,water,oxygen);
    const lost=awakeBefore-supported;
    state.battery=power.storedPower;
    state.lastPower=power.generatedPower;
    state.lastWater=water;
    state.lastOxygen=oxygen;
    if(eclipse)state.eclipseOccurred=true;
    if(lost>0){
      state.awake=supported;
      state.cryo=(state.cryo||0)+lost;
      if(supported===0)for(const facility of facilities)facility.workers=0;
    }
    return {
      ...power,
      eclipse,
      water,
      oxygen,
      awakeBefore,
      awakeAfter:state.awake||0,
      lost,
      activeFacilityOrders:active.map(facility=>facility.order)
    };
  }

  function canLaunchAutonomyEarly(state,scenario){
    return state.phase==='end'&&state.arrived&&!state.result&&state.round<scenario.managedRounds;
  }

  function runAutonomy(state,{rounds=10,eclipseRound=null,requiredAwake=4,onRound}={}){
    const reports=[];
    if((state.awake||0)<requiredAwake)return {result:'lose',failedRound:0,reports};
    for(let round=1;round<=rounds;round++){
      const report={round,...resolveProduction(state,{eclipse:round===eclipseRound})};
      reports.push(report);
      if(onRound)onRound(report);
      if(state.awake<requiredAwake)return {result:'lose',failedRound:round,reports};
    }
    return {result:'win',failedRound:null,reports};
  }

  return Object.freeze({batteryCapacity,assignedWorkers,resolveProduction,canLaunchAutonomyEarly,runAutonomy});
});
