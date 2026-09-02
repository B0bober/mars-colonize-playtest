(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.Scenario1Engine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const TYPES=['water','oxygen','solar','battery','habitat'];
  const TARGET=['water','oxygen','solar'];
  const NEED={water:2,oxygen:2,solar:1};
  const DECK_COUNTS={water:6,oxygen:6,solar:5,battery:4,habitat:4};

  function createTypeDeck(){
    const deck=[];
    for(const type of TYPES){
      for(let index=0;index<DECK_COUNTS[type];index++)deck.push(type);
    }
    return deck;
  }

  function mulberry32(seed){
    let value=seed>>>0;
    return function(){
      value|=0;
      value=value+0x6D2B79F5|0;
      let result=Math.imul(value^value>>>15,1|value);
      result=result+Math.imul(result^result>>>7,61|result)^result;
      return ((result^result>>>14)>>>0)/4294967296;
    };
  }

  function shuffleInPlace(items,random=Math.random){
    for(let index=items.length-1;index>0;index--){
      const swapIndex=Math.floor(random()*(index+1));
      [items[index],items[swapIndex]]=[items[swapIndex],items[index]];
    }
    return items;
  }

  function shuffledDeck(seed){return shuffleInPlace(createTypeDeck(),mulberry32(seed));}
  function count(hand,type){return hand.filter(card=>card===type).length;}
  function handKey(hand){return TYPES.map(type=>count(hand,type)).join(',');}
  function draw(deck,position,amount){
    return {cards:deck.slice(position,position+amount),position:Math.min(deck.length,position+amount)};
  }

  function discardOutcomes(hand,amount){
    const counts=TYPES.map(type=>count(hand,type));
    const results=[];
    function visit(typeIndex,left,removed){
      if(typeIndex===TYPES.length){
        if(left!==0)return;
        const next=[];
        for(let index=0;index<TYPES.length;index++){
          for(let number=0;number<counts[index]-removed[index];number++)next.push(TYPES[index]);
        }
        results.push(next);
        return;
      }
      for(let number=0;number<=Math.min(counts[typeIndex],left);number++){
        removed[typeIndex]=number;
        visit(typeIndex+1,left-number,removed);
      }
    }
    visit(0,amount,Array(TYPES.length).fill(0));
    return results;
  }

  function canWinOptimally(deck){
    const memo=new Map();
    function search(round,position,hand,builtMask){
      if(round>4)return false;
      const key=[round,position,handKey(hand),builtMask].join('|');
      if(memo.has(key))return memo.get(key);
      let current=[...hand],nextPosition=position;
      if(round>1){
        const next=draw(deck,nextPosition,3);
        current.push(...next.cards);
        nextPosition=next.position;
      }
      const discardRequired=round===1?0:Math.max(1,current.length-5);
      const hands=discardRequired?discardOutcomes(current,discardRequired):[current];
      for(const kept of hands){
        for(let targetIndex=0;targetIndex<TARGET.length;targetIndex++){
          const type=TARGET[targetIndex],bit=1<<targetIndex;
          if((builtMask&bit)||count(kept,type)<NEED[type])continue;
          const nextHand=[...kept];
          for(let number=0;number<NEED[type];number++)nextHand.splice(nextHand.indexOf(type),1);
          const nextMask=builtMask|bit;
          if(nextMask===7||search(round+1,nextPosition,nextHand,nextMask)){
            memo.set(key,true);
            return true;
          }
        }
        const remainingTargets=3-((builtMask&1)>0)-((builtMask&2)>0)-((builtMask&4)>0);
        if(4-round>=remainingTargets){
          const replacement=draw(deck,nextPosition,kept.length);
          if(search(round+1,replacement.position,replacement.cards,builtMask)){
            memo.set(key,true);
            return true;
          }
        }
        if(search(round+1,nextPosition,kept,builtMask)){
          memo.set(key,true);
          return true;
        }
      }
      memo.set(key,false);
      return false;
    }
    return search(1,5,deck.slice(0,5),0);
  }

  function cardsForPopDraw(drawOrder){
    const seen={};
    return drawOrder.map(type=>{
      const index=seen[type]||0;
      seen[type]=index+1;
      return {id:type+'-'+index,type};
    }).reverse();
  }

  function createSolvableDeck(options={}){
    const random=options.random||Math.random;
    const candidateFactory=options.candidateFactory||(()=>shuffleInPlace(createTypeDeck(),random));
    const maxAttempts=options.maxAttempts||1000;
    for(let attempts=1;attempts<=maxAttempts;attempts++){
      const drawOrder=[...candidateFactory(attempts)];
      if(canWinOptimally(drawOrder))return {cards:cardsForPopDraw(drawOrder),drawOrder,attempts};
    }
    throw new Error('Unable to generate a solvable Scenario 1 module sequence.');
  }

  return {TYPES,TARGET,NEED,DECK_COUNTS,createTypeDeck,mulberry32,shuffleInPlace,shuffledDeck,canWinOptimally,createSolvableDeck};
});
