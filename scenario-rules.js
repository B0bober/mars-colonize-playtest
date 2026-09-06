(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ScenarioRules=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TYPES=Object.freeze({
    solar:Object.freeze({name:'Solar',need:1,workers:0}),
    water:Object.freeze({name:'Water',need:2,workers:2}),
    oxygen:Object.freeze({name:'Oxygen',need:2,workers:2}),
    greenhouse:Object.freeze({name:'Greenhouse',need:1,workers:1}),
    recycler:Object.freeze({name:'Recycler',need:2,workers:1}),
    battery:Object.freeze({name:'Battery',need:1,workers:0}),
    habitat:Object.freeze({name:'Habitat',need:1,workers:0})
  });
  const sharedDeck={water:6,oxygen:6,solar:5,battery:4,habitat:4};
  function scenario(number,title,size,managedRounds,waves,deck,extra={}){
    return Object.freeze({number,title,size,managedRounds,arrivalRound:waves[0].round,
      waves:Object.freeze(waves.map(wave=>Object.freeze(wave))),
      population:waves.reduce((sum,wave)=>sum+wave.count,0),
      autonomyRounds:10,food:number>=3,wastewater:number===4,eclipseRound:null,
      deck:Object.freeze({...deck}),...extra});
  }
  const SCENARIOS=Object.freeze({
    1:scenario(1,'Sustainability',3,4,[{round:4,count:4}],sharedDeck),
    2:scenario(2,'Eclipse',3,6,[{round:5,count:4}],sharedDeck,{eclipseRound:5}),
    3:scenario(3,'Food Chain',4,14,[{round:14,count:5}],{water:6,oxygen:6,solar:6,greenhouse:6}),
    4:scenario(4,'Water Recycling',5,18,[{round:15,count:5},{round:18,count:2}],
      {water:5,oxygen:6,solar:7,greenhouse:6,recycler:3,battery:2})
  });
  function getScenario(number){
    if(!Object.hasOwn(SCENARIOS,number))throw new RangeError(`Unknown scenario: ${number}`);
    return SCENARIOS[number];
  }
  function random(seed){
    let value=seed>>>0;
    return function(){
      value=(value+0x6D2B79F5)|0;
      let result=Math.imul(value^(value>>>15),1|value);
      result^=result+Math.imul(result^(result>>>7),61|result);
      return ((result^(result>>>14))>>>0)/4294967296;
    };
  }
  function shuffle(cards,seed){
    const result=[...cards],next=random(seed);
    for(let i=result.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[result[i],result[j]]=[result[j],result[i]]}
    return result;
  }
  function createDeck(number,seed){
    const cards=[];
    for(const [type,count] of Object.entries(getScenario(number).deck)){
      for(let i=0;i<count;i++)cards.push({id:`${type}-${i}`,type});
    }
    return shuffle(cards,seed);
  }
  function validCell(index,size){return Number.isInteger(index)&&index>=0&&index<size*size}
  function neighbors(index,size){
    if(!validCell(index,size))return [];
    return [index-size,index+size,index-1,index+1].filter(next=>validCell(next,size)
      &&Math.abs(Math.floor(index/size)-Math.floor(next/size))+Math.abs(index%size-next%size)===1);
  }
  function starport(size,seed){
    const choice=Math.floor(random(seed^0x73a21b4f)()*size*4),side=Math.floor(choice/size),offset=choice%size;
    const row=side===0?-1:side===2?size:offset;
    const col=side===3?-1:side===1?size:offset;
    return {side:['north','east','south','west'][side],offset,row,col,
      entry:side===0?offset:side===1?offset*size+size-1:side===2?(size-1)*size+offset:offset*size};
  }
  function facilityStats(facility){
    const def=TYPES[facility.type];
    if(!def)throw new RangeError(`Unknown facility: ${facility.type}`);
    const tiles=facility.cells?facility.cells.length:def.need,units=tiles/def.need;
    return {tiles,workers:def.workers,
      power:['water','oxygen','recycler'].includes(facility.type)?units:facility.type==='greenhouse'?tiles:0,
      generation:facility.type==='solar'?tiles*2:0,
      water:facility.type==='water'?units*4:facility.type==='recycler'?units*3:0,
      oxygen:facility.type==='oxygen'?units*4:0,
      food:facility.type==='greenhouse'?tiles*2:0,
      waterInput:facility.type==='greenhouse'?tiles:0,
      wastewaterInput:facility.type==='recycler'?units*4:0,
      wastewaterCapacity:facility.type==='recycler'?units*4:0,
      batteryCapacity:facility.type==='battery'?tiles*2:0,
      housing:facility.type==='habitat'?tiles*4:0};
  }
  function resolvePower({solarPlants=0,storedPower=0,batteryCapacity=0,requestedLoads=0,eclipse=false}={}){
    const generatedPower=eclipse?0:Math.max(0,solarPlants)*2;
    const availablePower=generatedPower+Math.max(0,storedPower);
    const poweredLoads=Math.min(Math.max(0,requestedLoads),availablePower);
    return {generatedPower,availablePower,poweredLoads,usedStoredPower:Math.max(0,poweredLoads-generatedPower),
      storedPower:Math.min(Math.max(0,batteryCapacity),Math.max(0,availablePower-poweredLoads))};
  }
  return Object.freeze({TYPES,SCENARIOS,getScenario,random,shuffle,createDeck,validCell,neighbors,starport,facilityStats,resolvePower});
});
