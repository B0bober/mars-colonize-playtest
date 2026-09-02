(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ScenarioRules=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const SCENARIOS=Object.freeze({
    1:Object.freeze({number:1,title:'Sustainability',managedRounds:4,arrivalRound:4,eclipseRound:null}),
    2:Object.freeze({number:2,title:'Eclipse',managedRounds:6,arrivalRound:5,eclipseRound:5})
  });

  function getScenario(number){
    const scenario=SCENARIOS[number];
    if(!scenario)throw new RangeError(`Unknown scenario: ${number}`);
    return scenario;
  }

  function resolvePower({solarPlants=0,storedPower=0,batteryCapacity=0,requestedLoads=0,eclipse=false}={}){
    const generatedPower=eclipse?0:Math.max(0,solarPlants)*2;
    const availablePower=generatedPower+Math.max(0,storedPower);
    const poweredLoads=Math.min(Math.max(0,requestedLoads),availablePower);
    const usedStoredPower=Math.max(0,poweredLoads-generatedPower);
    const remainingPower=Math.max(0,availablePower-poweredLoads);
    return {
      generatedPower,
      availablePower,
      poweredLoads,
      usedStoredPower,
      storedPower:Math.min(Math.max(0,batteryCapacity),remainingPower)
    };
  }

  return Object.freeze({SCENARIOS,getScenario,resolvePower});
});
