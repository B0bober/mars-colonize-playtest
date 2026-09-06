(function(root,factory){
  const common=typeof module==='object'&&module.exports;
  const api=factory(common?require('./scenario-rules.js'):root.ScenarioRules,
    common?require('./scenario-session.js'):root.ScenarioSession,
    common?require('./scenario1-engine.js'):root.Scenario1Engine);
  if(common)module.exports=api;else root.ScenarioDeck=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Rules,Session,Legacy){
  'use strict';

  // These layouts are proof witnesses, never curated player decks or forced placements.
  function witnessLayout(number){
    const size=Rules.getScenario(number).size,path=[];
    for(let row=0;row<size;row++)for(let i=0;i<size;i++)path.push(row*size+(row%2?size-1-i:i));
    const counts=number===1?{water:2,oxygen:2,solar:1}:number===2?{water:2,oxygen:2,solar:1,battery:1}
      :number===3?{water:4,oxygen:4,solar:4,greenhouse:3}
      :{water:4,oxygen:4,solar:5,greenhouse:4,recycler:2};
    let offset=1;const layout={};
    for(const [type,count] of Object.entries(counts)){layout[type]=path.slice(offset,offset+count);offset+=count}
    return layout;
  }
  const tileCount=(state,type)=>state.board.filter(tile=>tile?.type===type).length;
  function targets(state){
    if(state.scenario===1)return {water:2,oxygen:2,solar:1};
    if(state.scenario===2)return {water:2,oxygen:2,solar:1,battery:1};
    if(state.scenario===3)return {water:4,oxygen:4,solar:4,greenhouse:3};
    return state.arrivals.length?{water:4,oxygen:4,solar:5,greenhouse:4,recycler:2}
      :{water:4,oxygen:4,solar:4,greenhouse:3,recycler:2};
  }
  function complete(state){return Object.entries(targets(state)).every(([type,count])=>tileCount(state,type)>=count)}
  function chooseRecycle(state,priority){
    const required=state.discardRequired,hand=state.hand,target=targets(state);
    let best=null,bestScore=-Infinity;
    function visit(index,kept){
      if(kept.length===5){
        const counts={};for(const card of kept)counts[card.type]=(counts[card.type]||0)+1;
        let score=0;
        for(const [type,count] of Object.entries(counts)){
          const remaining=Math.max(0,(target[type]||0)-tileCount(state,type));
          const useful=Math.min(count,remaining),need=Rules.TYPES[type].need;
          score+=useful*(10+priority[type]);
          if(useful>=need)score+=12+priority[type];
          // Preserve a later second-wave module when it does not crowd out first-wave needs.
          if(state.scenario===4&&!state.arrivals.length&&['solar','greenhouse'].includes(type)&&count>useful)score+=2;
        }
        if(score>bestScore){bestScore=score;best=new Set(kept.map(card=>card.id))}
        return;
      }
      if(index>=hand.length||kept.length+hand.length-index<5)return;
      visit(index+1,[...kept,hand[index]]);visit(index+1,kept);
    }
    if(required>0)visit(0,[]);
    return hand.filter(card=>!best?.has(card.id)).map(card=>card.id);
  }
  function findWitness(number,seed,deck,{policies=16,scheduled=false}={}){
    const layout=witnessLayout(number),reserved=new Set(Object.values(layout).flat());
    for(let policy=0;policy<policies;policy++){
      const state=Session.createState(number,{seed,deck}),random=Rules.random(policy*7919+37);
      const priority=Object.fromEntries(Object.keys(Rules.TYPES).map(type=>[type,random()*8]));
      const command=(type,fields={})=>Session.dispatch(state,{type,...fields});
      let steps=0;
      while(!state.result&&steps++<200){
        if(state.phase==='build'){
          const target=targets(state);
          const available=Object.keys(target).filter(type=>tileCount(state,type)<target[type]
            &&Session.countType(state,type)>=Rules.TYPES[type].need
            &&(type!=='greenhouse'||tileCount(state,'water')>=2)
            &&!(scheduled&&number===4&&state.arrivals.length===1&&type==='greenhouse'
              &&state.round<Rules.getScenario(4).waves[1].round))
            .sort((a,b)=>priority[b]-priority[a]);
          if(available.length){
            const type=available[0],cells=layout[type].filter(cell=>!state.board[cell]).slice(0,Rules.TYPES[type].need);
            command('beginBuild',{facility:type});for(const index of cells)command('cell',{index});
            if(!command('confirmBuild'))break;
          }else command(policy%3===1?'cycle':'pass');
        }else if(state.phase==='drop'){
          for(const id of chooseRecycle(state,priority))command('toggleRecycle',{id});
          if(!command('confirmRecycle'))break;
        }else if(state.phase==='arrival'){
          const index=state.board.findIndex((tile,index)=>!tile&&!reserved.has(index)&&Session.connectedIfLanding(state,index));
          if(index<0)break;
          command('cell',{index});command('confirmLanding');
        }else if(state.phase==='allocation'){
          for(const f of state.facilities){
            const workers=Session.stats(f).workers;
            if(workers&&!(number===4&&state.arrivals.length===1&&f.type==='recycler'))command('workers',{id:f.id,value:workers});
          }
          command('finishAllocation');
        }else if(state.phase==='end'){
          if(!scheduled&&complete(state)&&Session.canRequestArrival(state)&&(number!==2||state.battery>=2))command('requestArrival');
          else if(!scheduled&&complete(state)&&Session.canLaunchAutonomyEarly(state))command('earlyAutonomy');
          else command('endTurn');
        }else if(state.phase==='ready')command('launchAutonomy');
        else break;
      }
      if(state.result==='win')return {commands:state.history,round:state.round,policy,arrivals:state.arrivals};
    }
    return null;
  }
  function createDeal(number,{seed=1,maxAttempts=128,policies=16}={}){
    Rules.getScenario(number);
    if(number<3){
      const result=Legacy.createSolvableDeck({random:Rules.random(seed)});
      return {seed:seed>>>0,deck:result.cards,attempts:result.attempts,witness:null};
    }
    for(let attempt=0;attempt<maxAttempts;attempt++){
      const candidateSeed=(seed+Math.imul(attempt,0x9e3779b9))>>>0;
      const deck=Rules.createDeck(number,candidateSeed);
      const witness=findWitness(number,candidateSeed,deck,{policies});
      const scheduledWitness=witness?findWitness(number,candidateSeed,deck,{policies,scheduled:true}):null;
      if(witness&&scheduledWitness)return {seed:candidateSeed,deck,attempts:attempt+1,witness,scheduledWitness};
    }
    throw new Error('No verified deal found. Try another deal.');
  }
  return Object.freeze({createDeal,findWitness,witnessLayout});
});
